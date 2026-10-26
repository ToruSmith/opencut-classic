struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 色差 / RGB 分離(類似 OBS shaderfilter、Kdenlive 的 RGB split)
// scalars   = (位移 像素, 方向 角度, 模式 0=固定方向 1=由中心向外, 0)
// direction = 未使用
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let amount = uniforms.scalars.x;
    let angle = radians(uniforms.scalars.y);
    let radial = clamp(uniforms.scalars.z, 0.0, 1.0);
    let uv = input.tex_coord;

    let directional = vec2f(cos(angle), sin(angle)) * amount;
    // 由中心向外:越靠邊緣分離越明顯,像鏡頭的色散。對角線端點約等於 amount
    let from_center = (uv - vec2f(0.5)) * uniforms.resolution;
    let half_diagonal = max(length(uniforms.resolution) * 0.5, 1.0);
    let radial_offset = from_center / half_diagonal * amount;
    let offset = mix(directional, radial_offset, radial) / uniforms.resolution;

    let r = textureSample(input_texture, input_sampler, uv + offset);
    let g = textureSample(input_texture, input_sampler, uv);
    let b = textureSample(input_texture, input_sampler, uv - offset);

    // 顏色是預乘 alpha:每個通道都不超過自己的 alpha,所以取三者最大的 alpha 仍合法
    let alpha = max(g.a, max(r.a, b.a));
    return vec4f(r.r, g.g, b.b, alpha);
}
