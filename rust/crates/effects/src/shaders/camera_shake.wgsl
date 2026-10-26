struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 畫面震動(類似 CapCut / After Effects 的 Shake、Wiggle)
// scalars   = (幅度 像素, 旋轉 角度, 自動放大填滿 0/1, 種子)
// direction = (時間 秒, 每秒晃動次數)
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

// 1D 平滑雜訊:整數點取亂數,中間用 smoothstep 內插,回傳 -1..1
fn smooth_noise(t: f32, channel: u32) -> f32 {
    let i = floor(t);
    let f = t - i;
    let index = u32(max(i, 0.0));
    let a = hash01(index, channel);
    let b = hash01(index + 1u, channel);
    return mix(a, b, f * f * (3.0 - 2.0 * f)) * 2.0 - 1.0;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let amplitude = max(uniforms.scalars.x, 0.0);
    let max_rotation = radians(uniforms.scalars.y);
    let fill = uniforms.scalars.z > 0.5;
    let seed = u32(max(uniforms.scalars.w, 0.0)) * 3u;
    let t = max(uniforms.direction.x, 0.0) * max(uniforms.direction.y, 0.0);

    // 兩個不同頻率疊加,比單一頻率自然
    let dx = (smooth_noise(t, seed) * 0.7 + smooth_noise(t * 2.3, seed + 11u) * 0.3) * amplitude;
    let dy = (smooth_noise(t, seed + 1u) * 0.7 + smooth_noise(t * 2.3, seed + 12u) * 0.3) * amplitude;
    let angle = smooth_noise(t * 0.8, seed + 2u) * max_rotation;

    let resolution = uniforms.resolution;
    // 以像素為單位旋轉,長寬比不同時才不會變形
    var p = input.tex_coord * resolution - resolution * 0.5;
    if fill {
        // 放大到位移與旋轉後仍蓋滿畫面,不露出邊緣
        let half = resolution * 0.5;
        let rotated_extent = abs(cos(max_rotation)) * half + abs(sin(max_rotation)) * half.yx;
        let need = (rotated_extent + vec2f(amplitude)) / half;
        p = p / max(need.x, need.y);
    }
    let c = cos(angle);
    let s = sin(angle);
    p = vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
    p = p - vec2f(dx, dy);
    let uv = (p + resolution * 0.5) / resolution;
    return textureSample(input_texture, input_sampler, uv);
}
