struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

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
    let texel_size = vec2f(1.0, 1.0) / uniforms.resolution;
    let sigma = uniforms.scalars.x;
    let step_size = uniforms.scalars.y;

    var color = vec4f(0.0, 0.0, 0.0, 0.0);
    var total_weight = 0.0;

    // 高斯權重在 3.5σ 之外不到 0.3%,不必取樣。原本固定取 61 點;
    // 預設強度(σ≈3)只需約 23 點,預覽畫布較小時更少。上限仍是 ±30。
    // 迴圈上限只依 uniform,屬於一致控制流程,textureSample 可以放在裡面。
    let radius = clamp(i32(ceil(3.5 * sigma / max(step_size, 0.0001))), 1, 30);
    for (var index = -radius; index <= radius; index = index + 1) {
        let position = f32(index) * step_size;
        let weight = exp(-(position * position) / (2.0 * sigma * sigma));
        let sample_uv = input.tex_coord + (texel_size * uniforms.direction * position);
        color = color + textureSample(input_texture, input_sampler, sample_uv) * weight;
        total_weight = total_weight + weight;
    }

    return color / total_weight;
}
