struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 雙色調:亮度對應到「暗部色 → 亮部色」。顏色用色相(0..360)加共同的飽和度指定。
// scalars   = (強度 0..1, 飽和度 0..1, 對比 0..1, 未使用)
// direction = (暗部色相 度, 亮部色相 度)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> vec3f {
    let p = abs(fract(vec3f(h) + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3f(3.0));
    return v * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), s);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let amount = clamp(uniforms.scalars.x, 0.0, 1.0);
    let saturation = clamp(uniforms.scalars.y, 0.0, 1.0);
    let contrast = clamp(uniforms.scalars.z, 0.0, 1.0);
    let shadow = hsv_to_rgb(uniforms.direction.x / 360.0, saturation, 0.16);
    let highlight = hsv_to_rgb(uniforms.direction.y / 360.0, saturation * 0.7, 1.0);

    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    let straight = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);
    let luma = clamp(dot(straight, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let shaped = mix(luma, luma * luma * (3.0 - 2.0 * luma), contrast);
    let toned = mix(shadow, highlight, shaped);
    let rgb = mix(straight, toned, amount);
    return vec4f(rgb * src.a, src.a);
}
