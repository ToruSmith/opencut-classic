struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 馬賽克(類似 Kdenlive / MLT 的 pixelize、Shotcut 的 Mosaic)
// scalars   = (方塊大小 像素, 0, 0, 0)
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
    let block = max(uniforms.scalars.x, 1.0);
    let max_pixel = uniforms.resolution - vec2f(0.5);
    let cell = floor(input.tex_coord * uniforms.resolution / block) * block;
    let q = block * 0.25;

    // 每個方塊取 4 點平均,比只取中心一點穩定,畫面移動時比較不會閃
    let p0 = min(cell + vec2f(q, q), max_pixel) / uniforms.resolution;
    let p1 = min(cell + vec2f(3.0 * q, q), max_pixel) / uniforms.resolution;
    let p2 = min(cell + vec2f(q, 3.0 * q), max_pixel) / uniforms.resolution;
    let p3 = min(cell + vec2f(3.0 * q, 3.0 * q), max_pixel) / uniforms.resolution;

    // 預乘 alpha 下平均是線性運算,直接相加即可
    return (textureSample(input_texture, input_sampler, p0)
        + textureSample(input_texture, input_sampler, p1)
        + textureSample(input_texture, input_sampler, p2)
        + textureSample(input_texture, input_sampler, p3)) * 0.25;
}
