struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 分離色調:暗部與亮部各染上一種顏色,保持原本的亮度
// scalars   = (暗部色相 [0..360], 暗部強度 [0..1], 亮部色相 [0..360], 亮部強度 [0..1])
// direction = (平衡 [-1..1],負值讓暗部範圍變大、正值讓亮部範圍變大, 0)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn hue_to_rgb(hue_degrees: f32) -> vec3f {
    let h = fract(hue_degrees / 360.0) * 6.0;
    let r = clamp(abs(h - 3.0) - 1.0, 0.0, 1.0);
    let g = clamp(2.0 - abs(h - 2.0), 0.0, 1.0);
    let b = clamp(2.0 - abs(h - 4.0), 0.0, 1.0);
    return vec3f(r, g, b);
}

// 只取顏色的「色度方向」(亮度為 0),加上去不會讓畫面整體變亮或變暗
fn chroma_offset(hue_degrees: f32) -> vec3f {
    let c = hue_to_rgb(hue_degrees);
    return c - vec3f(luma(c));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    var rgb = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);

    let balance = clamp(uniforms.direction.x, -1.0, 1.0);
    let pivot = 0.5 - balance * 0.3;
    let l = luma(rgb);
    let shadow_weight = 1.0 - smoothstep(0.0, pivot * 2.0, l);
    let highlight_weight = smoothstep(pivot * 2.0 - 1.0, 1.0, l);

    rgb = rgb + chroma_offset(uniforms.scalars.x) * uniforms.scalars.y * shadow_weight * 0.35;
    rgb = rgb + chroma_offset(uniforms.scalars.z) * uniforms.scalars.w * highlight_weight * 0.35;

    rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
    return vec4f(rgb * src.a, src.a);
}
