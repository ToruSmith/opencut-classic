struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 底片顆粒(類似 Kdenlive / MLT 的 grain、Shotcut 的 Noise: Fast)
// scalars   = (強度 0..1, 顆粒大小 像素, 亂數種子(每格不同), 彩色 0/1)
// direction = (暗部保留 0..1, 0)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

// PCG 整數雜湊:比 fract(sin(...)) 穩定,不會因 GPU 浮點精度不同而出現條紋
fn pcg(value: u32) -> u32 {
    let state = value * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn random(cell: vec2u, seed: u32, channel: u32) -> f32 {
    let h = pcg(cell.x + pcg(cell.y + pcg(seed + channel * 1013904223u)));
    return f32(h) / 4294967295.0;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let amount = clamp(uniforms.scalars.x, 0.0, 1.0);
    let grain_size = max(uniforms.scalars.y, 1.0);
    let seed = u32(max(uniforms.scalars.z, 0.0));
    let colored = uniforms.scalars.w > 0.5;
    let shadow_protect = clamp(uniforms.direction.x, 0.0, 1.0);

    let color = textureSample(input_texture, input_sampler, input.tex_coord);
    let pixel = input.tex_coord * uniforms.resolution;
    let cell = vec2u(max(floor(pixel / grain_size), vec2f(0.0)));

    // 三個亂數平均成近似常態分佈的顆粒,比均勻雜訊柔和
    let mono = (random(cell, seed, 0u) + random(cell, seed, 1u) + random(cell, seed, 2u)) / 3.0 - 0.5;
    var noise = vec3f(mono);
    if colored {
        noise = vec3f(
            random(cell, seed, 3u) - 0.5,
            random(cell, seed, 4u) - 0.5,
            random(cell, seed, 5u) - 0.5,
        ) * 0.6 + vec3f(mono) * 0.4;
    }

    let straight = select(vec3f(0.0), color.rgb / color.a, color.a > 0.0001);
    let luma = dot(straight, vec3f(0.2126, 0.7152, 0.0722));
    // 暗部保留越高,黑色越乾淨(顆粒隨亮度淡出)
    let weight = mix(1.0, smoothstep(0.0, 0.35, luma), shadow_protect);
    let rgb = clamp(straight + noise * amount * 0.5 * weight, vec3f(0.0), vec3f(1.0));
    return vec4f(rgb * color.a, color.a);
}
