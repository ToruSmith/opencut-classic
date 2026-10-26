use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::{EffectPass, UniformValue};

const GAUSSIAN_BLUR_SHADER_ID: &str = "gaussian-blur";
const GAUSSIAN_BLUR_SHADER_SOURCE: &str = include_str!("shaders/gaussian_blur.wgsl");
const COLOR_GRADE_SHADER_ID: &str = "color-grade";
const COLOR_GRADE_SHADER_SOURCE: &str = include_str!("shaders/color_grade.wgsl");
const TONE_SHADER_ID: &str = "tone";
const TONE_SHADER_SOURCE: &str = include_str!("shaders/tone.wgsl");
const CHROMA_KEY_SHADER_ID: &str = "chroma-key";
const CHROMA_KEY_SHADER_SOURCE: &str = include_str!("shaders/chroma_key.wgsl");
const SHARPEN_SHADER_ID: &str = "sharpen";
const SHARPEN_SHADER_SOURCE: &str = include_str!("shaders/sharpen.wgsl");
const GLOW_SHADER_ID: &str = "glow";
const GLOW_SHADER_SOURCE: &str = include_str!("shaders/glow.wgsl");
const SPLIT_TONE_SHADER_ID: &str = "split-tone";
const SPLIT_TONE_SHADER_SOURCE: &str = include_str!("shaders/split_tone.wgsl");
const PIXELATE_SHADER_ID: &str = "pixelate";
const PIXELATE_SHADER_SOURCE: &str = include_str!("shaders/pixelate.wgsl");
const CHROMATIC_ABERRATION_SHADER_ID: &str = "chromatic-aberration";
const CHROMATIC_ABERRATION_SHADER_SOURCE: &str = include_str!("shaders/chromatic_aberration.wgsl");
const POSTERIZE_SHADER_ID: &str = "posterize";
const POSTERIZE_SHADER_SOURCE: &str = include_str!("shaders/posterize.wgsl");
const FILM_GRAIN_SHADER_ID: &str = "film-grain";
const FILM_GRAIN_SHADER_SOURCE: &str = include_str!("shaders/film_grain.wgsl");
const LUT_SHADER_ID: &str = "lut";
const LUT_SHADER_SOURCE: &str = include_str!("shaders/lut.wgsl");
const CAMERA_SHAKE_SHADER_ID: &str = "camera-shake";
const CAMERA_SHAKE_SHADER_SOURCE: &str = include_str!("shaders/camera_shake.wgsl");
const ZOOM_BLUR_SHADER_ID: &str = "zoom-blur";
const ZOOM_BLUR_SHADER_SOURCE: &str = include_str!("shaders/zoom_blur.wgsl");
const GLITCH_SHADER_ID: &str = "glitch";
const GLITCH_SHADER_SOURCE: &str = include_str!("shaders/glitch.wgsl");
const MIRROR_SHADER_ID: &str = "mirror";
const MIRROR_SHADER_SOURCE: &str = include_str!("shaders/mirror.wgsl");

/// 需要第二張貼圖(group 2)的 shader
fn requires_texture(shader: &str) -> bool {
    shader == LUT_SHADER_ID
}

pub struct ApplyEffectsOptions<'a> {
    pub source: &'a wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub passes: &'a [EffectPass],
}

/// 每個 pass 的輸出貼圖從哪裡來。合成器傳入自己的貼圖池,避免每格、每個 pass 都向 GPU 重新配置貼圖。
pub type AcquireTexture<'a> = dyn FnMut(u32, u32) -> wgpu::Texture + 'a;

pub struct EffectPipeline {
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
}

#[derive(Debug, Error)]
pub enum EffectsError {
    #[error("At least one effect pass is required")]
    MissingEffectPasses,
    #[error("Unknown effect shader '{shader}'")]
    UnknownEffectShader { shader: String },
    #[error("Missing uniform '{uniform}' for shader '{shader}'")]
    MissingUniform { shader: String, uniform: String },
    #[error("Uniform '{uniform}' for shader '{shader}' must be a number")]
    InvalidNumberUniform { shader: String, uniform: String },
    #[error(
        "Uniform '{uniform}' for shader '{shader}' must be a vector of length {expected_length}"
    )]
    InvalidVectorUniform {
        shader: String,
        uniform: String,
        expected_length: usize,
    },
    #[error("Shader '{shader}' does not support uniform '{uniform}'")]
    UnsupportedUniform { shader: String, uniform: String },
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct EffectUniformBuffer {
    resolution: [f32; 2],
    direction: [f32; 2],
    scalars: [f32; 4],
}

impl EffectPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let uniform_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-uniform-bind-group-layout"),
                    entries: &[wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    }],
                });
        let vertex_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-fullscreen-shader"),
                    source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
                });
        let pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                    ],
                    immediate_size: 0,
                });
        // LUT 這類 shader 多一組 group(2) 的貼圖 + 取樣器,格式和輸入貼圖相同
        let textured_pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-textured-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                        Some(context.texture_sampler_bind_group_layout()),
                    ],
                    immediate_size: 0,
                });
        let build_pipeline_with_layout = |label: &str,
                                          source: &str,
                                          layout: &wgpu::PipelineLayout| {
            let fragment_module =
                context
                    .device()
                    .create_shader_module(wgpu::ShaderModuleDescriptor {
                        label: Some(label),
                        source: wgpu::ShaderSource::Wgsl(source.into()),
                    });
            context
                .device()
                .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                    label: Some(label),
                    layout: Some(layout),
                    vertex: wgpu::VertexState {
                        module: &vertex_shader_module,
                        entry_point: Some("vertex_main"),
                        buffers: &[wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &[wgpu::VertexAttribute {
                                format: wgpu::VertexFormat::Float32x2,
                                offset: 0,
                                shader_location: 0,
                            }],
                        }],
                        compilation_options: wgpu::PipelineCompilationOptions::default(),
                    },
                    fragment: Some(wgpu::FragmentState {
                        module: &fragment_module,
                        entry_point: Some("fragment_main"),
                        targets: &[Some(wgpu::ColorTargetState {
                            format: context.texture_format(),
                            blend: None,
                            write_mask: wgpu::ColorWrites::ALL,
                        })],
                        compilation_options: wgpu::PipelineCompilationOptions::default(),
                    }),
                    primitive: wgpu::PrimitiveState::default(),
                    depth_stencil: None,
                    multisample: wgpu::MultisampleState::default(),
                    multiview_mask: None,
                    cache: None,
                })
        };
        let build_pipeline = |label: &str, source: &str| {
            build_pipeline_with_layout(label, source, &pipeline_layout)
        };
        let pipelines = HashMap::from([
            (
                GAUSSIAN_BLUR_SHADER_ID.to_string(),
                build_pipeline("effects-gaussian-blur", GAUSSIAN_BLUR_SHADER_SOURCE),
            ),
            (
                COLOR_GRADE_SHADER_ID.to_string(),
                build_pipeline("effects-color-grade", COLOR_GRADE_SHADER_SOURCE),
            ),
            (
                TONE_SHADER_ID.to_string(),
                build_pipeline("effects-tone", TONE_SHADER_SOURCE),
            ),
            (
                CHROMA_KEY_SHADER_ID.to_string(),
                build_pipeline("effects-chroma-key", CHROMA_KEY_SHADER_SOURCE),
            ),
            (
                SHARPEN_SHADER_ID.to_string(),
                build_pipeline("effects-sharpen", SHARPEN_SHADER_SOURCE),
            ),
            (
                GLOW_SHADER_ID.to_string(),
                build_pipeline("effects-glow", GLOW_SHADER_SOURCE),
            ),
            (
                SPLIT_TONE_SHADER_ID.to_string(),
                build_pipeline("effects-split-tone", SPLIT_TONE_SHADER_SOURCE),
            ),
            (
                PIXELATE_SHADER_ID.to_string(),
                build_pipeline("effects-pixelate", PIXELATE_SHADER_SOURCE),
            ),
            (
                CHROMATIC_ABERRATION_SHADER_ID.to_string(),
                build_pipeline(
                    "effects-chromatic-aberration",
                    CHROMATIC_ABERRATION_SHADER_SOURCE,
                ),
            ),
            (
                POSTERIZE_SHADER_ID.to_string(),
                build_pipeline("effects-posterize", POSTERIZE_SHADER_SOURCE),
            ),
            (
                FILM_GRAIN_SHADER_ID.to_string(),
                build_pipeline("effects-film-grain", FILM_GRAIN_SHADER_SOURCE),
            ),
            (
                CAMERA_SHAKE_SHADER_ID.to_string(),
                build_pipeline("effects-camera-shake", CAMERA_SHAKE_SHADER_SOURCE),
            ),
            (
                ZOOM_BLUR_SHADER_ID.to_string(),
                build_pipeline("effects-zoom-blur", ZOOM_BLUR_SHADER_SOURCE),
            ),
            (
                GLITCH_SHADER_ID.to_string(),
                build_pipeline("effects-glitch", GLITCH_SHADER_SOURCE),
            ),
            (
                MIRROR_SHADER_ID.to_string(),
                build_pipeline("effects-mirror", MIRROR_SHADER_SOURCE),
            ),
            (
                LUT_SHADER_ID.to_string(),
                build_pipeline_with_layout(
                    "effects-lut",
                    LUT_SHADER_SOURCE,
                    &textured_pipeline_layout,
                ),
            ),
        ]);

        Self {
            uniform_bind_group_layout,
            pipelines,
        }
    }

    pub fn apply(
        &self,
        context: &GpuContext,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("effects-command-encoder"),
                });
        let mut acquire = |width: u32, height: u32| {
            context.create_render_texture(width, height, "effects-pass-output")
        };
        let output = self.apply_with_encoder(
            context,
            &mut encoder,
            ApplyEffectsOptions {
                source,
                width,
                height,
                passes,
            },
            &mut acquire,
        )?;
        context.queue().submit([encoder.finish()]);
        Ok(output)
    }

    pub fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
        acquire: &mut AcquireTexture<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut current_texture: Option<wgpu::Texture> = None;

        for pass in passes {
            // 需要第二張貼圖卻沒有(例如 LUT 檔還沒載入、或縮圖預覽):略過這個 pass
            if requires_texture(&pass.shader) && pass.texture.is_none() {
                continue;
            }
            let input_texture = current_texture.as_ref().unwrap_or(source);
            let output_texture = acquire(width, height);
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let texture_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-texture-bind-group"),
                        layout: context.texture_sampler_bind_group_layout(),
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                            },
                        ],
                    });
            let uniform_buffer =
                context
                    .device()
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("effects-uniform-buffer"),
                        contents: bytemuck::bytes_of(&pack_effect_uniforms(pass, width, height)?),
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    });
            let uniform_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-uniform-bind-group"),
                        layout: &self.uniform_bind_group_layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: uniform_buffer.as_entire_binding(),
                        }],
                    });
            let extra_bind_group = match (&pass.texture, requires_texture(&pass.shader)) {
                (Some(texture), true) => {
                    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
                    Some(
                        context
                            .device()
                            .create_bind_group(&wgpu::BindGroupDescriptor {
                                label: Some("effects-extra-texture-bind-group"),
                                layout: context.texture_sampler_bind_group_layout(),
                                entries: &[
                                    wgpu::BindGroupEntry {
                                        binding: 0,
                                        resource: wgpu::BindingResource::TextureView(&view),
                                    },
                                    wgpu::BindGroupEntry {
                                        binding: 1,
                                        resource: wgpu::BindingResource::Sampler(
                                            context.linear_sampler(),
                                        ),
                                    },
                                ],
                            }),
                    )
                }
                _ => None,
            };
            let pipeline = self.pipelines.get(&pass.shader).ok_or_else(|| {
                EffectsError::UnknownEffectShader {
                    shader: pass.shader.clone(),
                }
            })?;

            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("effects-render-pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    occlusion_query_set: None,
                    timestamp_writes: None,
                    multiview_mask: None,
                });
                render_pass.set_pipeline(pipeline);
                render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
                render_pass.set_bind_group(0, &texture_bind_group, &[]);
                render_pass.set_bind_group(1, &uniform_bind_group, &[]);
                if let Some(extra_bind_group) = &extra_bind_group {
                    render_pass.set_bind_group(2, extra_bind_group, &[]);
                }
                render_pass.draw(0..6, 0..1);
            }

            current_texture = Some(output_texture);
        }

        if passes.is_empty() {
            return Err(EffectsError::MissingEffectPasses);
        }
        // 全部 pass 都被略過時原圖照常輸出
        Ok(current_texture.unwrap_or_else(|| source.clone()))
    }
}

fn pack_effect_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let shader = pass.shader.as_str();

    if shader == COLOR_GRADE_SHADER_ID {
        const KNOWN: [&str; 6] = [
            "u_brightness",
            "u_contrast",
            "u_saturation",
            "u_hue",
            "u_sepia",
            "u_vignette",
        ];
        for uniform in pass.uniforms.keys() {
            if !KNOWN.contains(&uniform.as_str()) {
                return Err(EffectsError::UnsupportedUniform {
                    shader: shader.to_string(),
                    uniform: uniform.clone(),
                });
            }
        }
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [
                read_number_uniform(pass, "u_sepia")?,
                read_number_uniform(pass, "u_vignette")?,
            ],
            scalars: [
                read_number_uniform(pass, "u_brightness")?,
                read_number_uniform(pass, "u_contrast")?,
                read_number_uniform(pass, "u_saturation")?,
                read_number_uniform(pass, "u_hue")?,
            ],
        });
    }

    if shader == TONE_SHADER_ID {
        const KNOWN: [&str; 6] = [
            "u_temperature",
            "u_tint",
            "u_shadows",
            "u_highlights",
            "u_exposure",
            "u_fade",
        ];
        for uniform in pass.uniforms.keys() {
            if !KNOWN.contains(&uniform.as_str()) {
                return Err(EffectsError::UnsupportedUniform {
                    shader: shader.to_string(),
                    uniform: uniform.clone(),
                });
            }
        }
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [
                read_number_uniform(pass, "u_exposure")?,
                read_number_uniform(pass, "u_fade")?,
            ],
            scalars: [
                read_number_uniform(pass, "u_temperature")?,
                read_number_uniform(pass, "u_tint")?,
                read_number_uniform(pass, "u_shadows")?,
                read_number_uniform(pass, "u_highlights")?,
            ],
        });
    }

    if shader == CHROMA_KEY_SHADER_ID {
        const KNOWN: [&str; 4] = ["u_key", "u_similarity", "u_smoothness", "u_spill"];
        for uniform in pass.uniforms.keys() {
            if !KNOWN.contains(&uniform.as_str()) {
                return Err(EffectsError::UnsupportedUniform {
                    shader: shader.to_string(),
                    uniform: uniform.clone(),
                });
            }
        }
        let key = read_vec3_uniform(pass, "u_key")?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [
                read_number_uniform(pass, "u_smoothness")?,
                read_number_uniform(pass, "u_spill")?,
            ],
            scalars: [key[0], key[1], key[2], read_number_uniform(pass, "u_similarity")?],
        });
    }

    if shader == SHARPEN_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_amount", "u_radius"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [
                read_number_uniform(pass, "u_amount")?,
                read_number_uniform(pass, "u_radius")?,
                0.0,
                0.0,
            ],
        });
    }

    if shader == GLOW_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_intensity", "u_radius", "u_threshold"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [
                read_number_uniform(pass, "u_intensity")?,
                read_number_uniform(pass, "u_radius")?,
                read_number_uniform(pass, "u_threshold")?,
                0.0,
            ],
        });
    }

    if shader == SPLIT_TONE_SHADER_ID {
        reject_unknown_uniforms(
            pass,
            &[
                "u_shadow_hue",
                "u_shadow_amount",
                "u_highlight_hue",
                "u_highlight_amount",
                "u_balance",
            ],
        )?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [read_number_uniform(pass, "u_balance")?, 0.0],
            scalars: [
                read_number_uniform(pass, "u_shadow_hue")?,
                read_number_uniform(pass, "u_shadow_amount")?,
                read_number_uniform(pass, "u_highlight_hue")?,
                read_number_uniform(pass, "u_highlight_amount")?,
            ],
        });
    }

    if shader == PIXELATE_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_block"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [read_number_uniform(pass, "u_block")?, 0.0, 0.0, 0.0],
        });
    }

    if shader == CHROMATIC_ABERRATION_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_amount", "u_angle", "u_radial"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [
                read_number_uniform(pass, "u_amount")?,
                read_number_uniform(pass, "u_angle")?,
                read_number_uniform(pass, "u_radial")?,
                0.0,
            ],
        });
    }

    if shader == POSTERIZE_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_levels"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [read_number_uniform(pass, "u_levels")?, 0.0, 0.0, 0.0],
        });
    }

    if shader == FILM_GRAIN_SHADER_ID {
        reject_unknown_uniforms(
            pass,
            &["u_amount", "u_size", "u_seed", "u_color", "u_shadow_protect"],
        )?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [read_number_uniform(pass, "u_shadow_protect")?, 0.0],
            scalars: [
                read_number_uniform(pass, "u_amount")?,
                read_number_uniform(pass, "u_size")?,
                read_number_uniform(pass, "u_seed")?,
                read_number_uniform(pass, "u_color")?,
            ],
        });
    }

    if shader == CAMERA_SHAKE_SHADER_ID {
        reject_unknown_uniforms(
            pass,
            &["u_amount", "u_rotation", "u_fill", "u_seed", "u_time", "u_speed"],
        )?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [
                read_number_uniform(pass, "u_time")?,
                read_number_uniform(pass, "u_speed")?,
            ],
            scalars: [
                read_number_uniform(pass, "u_amount")?,
                read_number_uniform(pass, "u_rotation")?,
                read_number_uniform(pass, "u_fill")?,
                read_number_uniform(pass, "u_seed")?,
            ],
        });
    }

    if shader == ZOOM_BLUR_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_strength", "u_center_x", "u_center_y"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [
                read_number_uniform(pass, "u_strength")?,
                read_number_uniform(pass, "u_center_x")?,
                read_number_uniform(pass, "u_center_y")?,
                0.0,
            ],
        });
    }

    if shader == GLITCH_SHADER_ID {
        reject_unknown_uniforms(
            pass,
            &["u_intensity", "u_band", "u_shift", "u_seed", "u_time", "u_rate"],
        )?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [
                read_number_uniform(pass, "u_time")?,
                read_number_uniform(pass, "u_rate")?,
            ],
            scalars: [
                read_number_uniform(pass, "u_intensity")?,
                read_number_uniform(pass, "u_band")?,
                read_number_uniform(pass, "u_shift")?,
                read_number_uniform(pass, "u_seed")?,
            ],
        });
    }

    if shader == MIRROR_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_mode", "u_flip"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [
                read_number_uniform(pass, "u_mode")?,
                read_number_uniform(pass, "u_flip")?,
                0.0,
                0.0,
            ],
        });
    }

    if shader == LUT_SHADER_ID {
        reject_unknown_uniforms(pass, &["u_size", "u_cols", "u_rows", "u_intensity"])?;
        return Ok(EffectUniformBuffer {
            resolution: [width as f32, height as f32],
            direction: [0.0, 0.0],
            scalars: [
                read_number_uniform(pass, "u_size")?,
                read_number_uniform(pass, "u_cols")?,
                read_number_uniform(pass, "u_rows")?,
                read_number_uniform(pass, "u_intensity")?,
            ],
        });
    }

    let sigma = read_number_uniform(pass, "u_sigma")?;
    let step = read_number_uniform(pass, "u_step")?;
    let direction = read_vec2_uniform(pass, "u_direction")?;

    for uniform in pass.uniforms.keys() {
        if uniform == "u_sigma" || uniform == "u_step" || uniform == "u_direction" {
            continue;
        }
        return Err(EffectsError::UnsupportedUniform {
            shader: shader.to_string(),
            uniform: uniform.clone(),
        });
    }

    Ok(EffectUniformBuffer {
        resolution: [width as f32, height as f32],
        direction,
        scalars: [sigma, step, 0.0, 0.0],
    })
}

fn reject_unknown_uniforms(pass: &EffectPass, known: &[&str]) -> Result<(), EffectsError> {
    for uniform in pass.uniforms.keys() {
        if !known.contains(&uniform.as_str()) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: uniform.clone(),
            });
        }
    }
    Ok(())
}

fn read_number_uniform(pass: &EffectPass, uniform: &str) -> Result<f32, EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    match value {
        UniformValue::Number(value) => Ok(*value),
        UniformValue::Vector(_) => Err(EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        }),
    }
}

fn read_vec3_uniform(pass: &EffectPass, uniform: &str) -> Result<[f32; 3], EffectsError> {
    let invalid = || EffectsError::InvalidVectorUniform {
        shader: pass.shader.clone(),
        uniform: uniform.to_string(),
        expected_length: 3,
    };
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    let UniformValue::Vector(values) = value else {
        return Err(invalid());
    };
    if values.len() != 3 {
        return Err(invalid());
    }
    Ok([values[0], values[1], values[2]])
}

fn read_vec2_uniform(pass: &EffectPass, uniform: &str) -> Result<[f32; 2], EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    let UniformValue::Vector(values) = value else {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    };
    if values.len() != 2 {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    }
    Ok([values[0], values[1]])
}
