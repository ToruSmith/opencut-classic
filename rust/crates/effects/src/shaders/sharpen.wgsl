struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 反銳化遮罩(unsharp mask):原圖 + 強度 × (原圖 - 周圍平均)
// scalars   = (amount [0..3], radius 像素, 0, 0)
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
    let radius = max(uniforms.scalars.y, 0.5);
    let texel = radius / uniforms.resolution;
    let uv = input.tex_coord;

    // 顏色是預乘 alpha,模糊與相減都是線性運算,可以直接在預乘空間做
    let center = textureSample(input_texture, input_sampler, uv);
    let n = textureSample(input_texture, input_sampler, uv + vec2f(0.0, -texel.y));
    let s = textureSample(input_texture, input_sampler, uv + vec2f(0.0, texel.y));
    let e = textureSample(input_texture, input_sampler, uv + vec2f(texel.x, 0.0));
    let w = textureSample(input_texture, input_sampler, uv + vec2f(-texel.x, 0.0));
    let ne = textureSample(input_texture, input_sampler, uv + vec2f(texel.x, -texel.y));
    let nw = textureSample(input_texture, input_sampler, uv + vec2f(-texel.x, -texel.y));
    let se = textureSample(input_texture, input_sampler, uv + vec2f(texel.x, texel.y));
    let sw = textureSample(input_texture, input_sampler, uv + vec2f(-texel.x, texel.y));

    // 3x3 高斯權重(1 2 1 / 2 4 2 / 1 2 1)
    let blurred = (center * 4.0 + (n + s + e + w) * 2.0 + (ne + nw + se + sw)) / 16.0;
    let detail = center.rgb - blurred.rgb;
    let rgb = clamp(center.rgb + detail * amount, vec3f(0.0), vec3f(center.a));
    return vec4f(rgb, center.a);
}
