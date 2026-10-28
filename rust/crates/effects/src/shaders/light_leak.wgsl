struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 漏光:兩團柔和的彩色光斑在畫面上緩慢漂移,用「濾色」疊在畫面上。
// scalars   = (強度 0..1, 色相 度, 大小 0..1, 速度)
// direction = (時間 秒, 種子)
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
    let intensity = clamp(uniforms.scalars.x, 0.0, 1.0);
    let hue = uniforms.scalars.y / 360.0;
    let size = clamp(uniforms.scalars.z, 0.0, 1.0);
    let speed = uniforms.scalars.w;
    let time = max(uniforms.direction.x, 0.0);
    let seed = max(uniforms.direction.y, 0.0);

    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    let straight = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);

    let t = time * speed;
    let s = seed * 1.7;
    let c1 = vec2f(0.5 + 0.55 * sin(t * 0.55 + s), 0.5 + 0.55 * sin(t * 0.41 + s * 2.3 + 1.0));
    let c2 = vec2f(0.5 + 0.55 * sin(t * 0.37 + s * 3.1 + 2.0), 0.5 + 0.55 * sin(t * 0.63 + s + 4.0));
    let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);
    let radius = mix(0.25, 0.85, size);
    let q = vec2f(aspect, 1.0);
    let d1 = length((input.tex_coord - c1) * q);
    let d2 = length((input.tex_coord - c2) * q);
    let f1 = exp(-(d1 * d1) / (radius * radius * 0.5));
    let f2 = exp(-(d2 * d2) / (radius * radius * 0.5));
    let leak = hsv_to_rgb(hue, 0.85, 1.0) * f1 + hsv_to_rgb(hue + 0.11, 0.9, 1.0) * f2 * 0.8;

    let lit = vec3f(1.0) - (vec3f(1.0) - straight) * (vec3f(1.0) - clamp(leak * intensity, vec3f(0.0), vec3f(1.0)));
    return vec4f(lit * src.a, src.a);
}
