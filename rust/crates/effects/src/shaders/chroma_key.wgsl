struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// scalars   = (key.r, key.g, key.b, similarity)  key 是 sRGB 0..1
// direction = (smoothness, spill)
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

// 只比較色度(Cb, Cr),不比較亮度,所以同一種綠色的明暗不同也能一起去掉
fn chroma(c: vec3f) -> vec2f {
    return vec2f(
        -0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
        0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b
    );
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    // 合成器使用 premultiplied alpha,先還原成直通色再比較
    let rgb = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);

    let key = uniforms.scalars.xyz;
    let similarity = uniforms.scalars.w;
    let smoothness = max(uniforms.direction.x, 0.0001);
    let spill = uniforms.direction.y;

    let dist = distance(chroma(rgb), chroma(key));

    // 距離小於 similarity 完全透明,超過 similarity + smoothness 完全保留
    let keep = smoothstep(similarity, similarity + smoothness, dist);

    // 去溢色:邊緣仍帶有背景色的像素,往灰階拉一點
    let edge = 1.0 - smoothstep(similarity + smoothness, similarity + smoothness + 0.2, dist);
    let despilled = mix(rgb, vec3f(luma(rgb)), clamp(spill * edge, 0.0, 1.0));

    let alpha = src.a * keep;
    return vec4f(clamp(despilled, vec3f(0.0), vec3f(1.0)) * alpha, alpha);
}
