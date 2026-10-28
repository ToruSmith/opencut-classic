struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// VHS 錄影帶:逐行橫向抖動、移動的追蹤雜訊帶、色彩暈開、掃描線、雜點。
// scalars   = (強度 0..1, 掃描線 0..1, 抖動 像素, 種子)
// direction = (時間 秒, 未使用)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

const PI: f32 = 3.14159265;

fn pcg(value: u32) -> u32 {
    let state = value * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rand2(a: u32, b: u32) -> f32 {
    return f32(pcg(a + pcg(b))) / 4294967295.0;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let intensity = clamp(uniforms.scalars.x, 0.0, 1.0);
    let scan = clamp(uniforms.scalars.y, 0.0, 1.0);
    let jitter = max(uniforms.scalars.z, 0.0);
    let seed = u32(max(uniforms.scalars.w, 0.0)) * 977u;
    let time = max(uniforms.direction.x, 0.0);
    let resolution = uniforms.resolution;
    let uv = input.tex_coord;
    let pixel = uv * resolution;

    let tick = u32(floor(time * 24.0)) + seed;
    let row = u32(max(floor(pixel.y / 2.0), 0.0));
    // 追蹤帶:從下往上慢慢移動,帶內位移與雜點都變強
    let band_y = 1.0 - fract(time * 0.12 + f32(seed % 97u) * 0.01);
    let band = smoothstep(0.07, 0.0, abs(uv.y - band_y));
    let wobble = (rand2(row / 3u, tick) - 0.5) * jitter * intensity * 0.5;
    let tear = band * jitter * intensity * (0.8 + 0.6 * sin(uv.y * 90.0 + time * 40.0));
    let shift = (wobble + tear) / resolution.x;
    // 色彩橫向暈開(紅偏右、藍偏左)
    let bleed = (1.5 + 5.0 * intensity) / resolution.x;

    let r = textureSample(input_texture, input_sampler, uv + vec2f(shift + bleed, 0.0));
    let g = textureSample(input_texture, input_sampler, uv + vec2f(shift, 0.0));
    let b = textureSample(input_texture, input_sampler, uv + vec2f(shift - bleed, 0.0));
    let alpha = max(g.a, max(r.a, b.a));
    var rgb = vec3f(r.r, g.g, b.b);

    // 掃描線:每 2 像素一個週期
    let scanline = 1.0 - scan * 0.38 * (0.5 + 0.5 * sin(pixel.y * PI));
    rgb = rgb * scanline;
    // 雜點:追蹤帶內更多
    let px = vec2u(max(floor(pixel), vec2f(0.0)));
    let noise = (rand2(px.x + px.y * 4099u, tick + 31u) - 0.5) * 0.22 * intensity * (1.0 + band * 3.0);
    rgb = clamp(rgb + vec3f(noise) * alpha, vec3f(0.0), vec3f(alpha));
    return vec4f(rgb, alpha);
}
