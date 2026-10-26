struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 色調分離(類似 Shotcut / GIMP 的 Posterize)
// scalars   = (每個通道的階數 2..32, 0, 0, 0)
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
    let steps = max(floor(uniforms.scalars.x), 2.0) - 1.0;
    let color = textureSample(input_texture, input_sampler, input.tex_coord);
    // 在非預乘空間量化,再乘回 alpha;完全透明的地方原樣輸出
    let straight = select(vec3f(0.0), color.rgb / color.a, color.a > 0.0001);
    let quantized = floor(clamp(straight, vec3f(0.0), vec3f(1.0)) * steps + 0.5) / steps;
    return vec4f(quantized * color.a, color.a);
}
