struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 集中線(漫畫速度線):從畫面中心放射的線條,往外變粗,每秒 12 次換一組。
// scalars   = (強度 0..1, 線條數量, 內圈留白 0..0.95(畫面角落 = 1), 顏色 0 = 白 / 1 = 黑)
// direction = (時間 秒, 種子)
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
    let count = clamp(uniforms.scalars.y, 8.0, 240.0);
    let inner = clamp(uniforms.scalars.z, 0.0, 0.95);
    let dark = uniforms.scalars.w > 0.5;
    let time = max(uniforms.direction.x, 0.0);
    let seed = u32(max(uniforms.direction.y, 0.0)) * 131u;

    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);
    let p = (input.tex_coord - vec2f(0.5)) * vec2f(aspect, 1.0) * 2.0;
    let radius = length(p) / length(vec2f(aspect, 1.0));
    let turn = atan2(p.y, p.x) / (2.0 * PI) + 0.5;
    let scaled = turn * count;
    let line_id = u32(floor(scaled));
    let across = abs(fract(scaled) - 0.5) * 2.0;

    let tick = u32(floor(time * 12.0));
    let h = rand2(line_id + seed, tick);
    let h2 = rand2(line_id + seed + 7919u, tick);
    // 內圈留白處線寬為 0,往外慢慢變粗;約 65% 的線有顯示
    let taper = smoothstep(inner, 1.0, radius);
    let width = mix(0.12, 0.75, h) * taper;
    let line = 1.0 - smoothstep(max(width - 0.2, 0.0), max(width, 0.0001), across);
    let mask = line * step(0.35, h2) * intensity;

    let color = select(vec3f(1.0), vec3f(0.0), dark);
    // 疊在畫面上方(over):線條不透明度 = mask
    return src * (1.0 - mask) + vec4f(color * mask, mask);
}
