struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 故障(類似 CapCut / Premiere 外掛的 Glitch):隨機水平條紋錯位 + RGB 分離
// scalars   = (強度 0..1, 條紋高度 像素, 錯位最大距離 像素, 種子)
// direction = (時間 秒, 每秒變化次數)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

// PCG 整數雜湊(同 film_grain.wgsl)
fn pcg(value: u32) -> u32 {
    let state = value * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn hash01(a: u32, b: u32) -> f32 {
    return f32(pcg(a + pcg(b))) / 4294967295.0;
}

fn sample_shifted(uv: vec2f) -> vec4f {
    // 水平方向循環取樣,錯位出去的部分從另一邊回來,看起來像訊號錯亂
    return textureSample(input_texture, input_sampler, vec2f(fract(uv.x), uv.y));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let intensity = clamp(uniforms.scalars.x, 0.0, 1.0);
    let band_height = max(uniforms.scalars.y, 1.0);
    let max_shift = max(uniforms.scalars.z, 0.0);
    let base_seed = u32(max(uniforms.scalars.w, 0.0)) * 7919u;
    let step_index = u32(max(floor(uniforms.direction.x * max(uniforms.direction.y, 0.0)), 0.0));
    let seed = base_seed + step_index;
    let uv = input.tex_coord;
    let pixel = uv * uniforms.resolution;

    // 有些時刻整個畫面不故障,強度越高越常發生
    let frame_active = hash01(seed, 101u) < mix(0.25, 1.0, intensity);
    // 兩種粗細的條紋疊加,比固定高度自然
    let coarse_band = u32(floor(pixel.y / (band_height * 3.0)));
    let fine_band = u32(floor(pixel.y / band_height));
    let coarse_on = hash01(seed * 31u + coarse_band, 7u) < intensity * 0.35;
    let fine_on = hash01(seed * 17u + fine_band, 3u) < intensity * 0.25;
    let band_on = frame_active && (coarse_on || fine_on);

    let band_key = select(fine_band + 1000u, coarse_band, coarse_on);
    let shift_px = (hash01(seed * 13u + band_key, 5u) * 2.0 - 1.0) * max_shift * intensity;
    let shift = select(0.0, shift_px / uniforms.resolution.x, band_on);
    // 錯位的條紋同時做 RGB 分離
    let split = select(0.0, shift * 0.35 + 2.0 * intensity / uniforms.resolution.x, band_on);

    let g = sample_shifted(uv + vec2f(shift, 0.0));
    let r = sample_shifted(uv + vec2f(shift + split, 0.0));
    let b = sample_shifted(uv + vec2f(shift - split, 0.0));
    // 預乘 alpha:每個通道不超過自己的 alpha,取三者最大的 alpha 仍合法
    let alpha = max(g.a, max(r.a, b.a));
    return vec4f(r.r, g.g, b.b, alpha);
}
