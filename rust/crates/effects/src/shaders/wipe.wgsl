struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 擦除:把圖層擦成透明,露出下面的畫面。轉場用:progress 做 0 → 1 的關鍵影格。
// scalars   = (模式, 進度 0..1, 柔邊 0..1, 角度 度)
//   模式(基本值;加 16 = 反向):
//     0 線性、1 圓形光圈、2 時鐘、3 百葉窗、4 棋盤、5 菱形、6 噪點溶解、7 方塊崩落、8 對開(從中線往兩側)
//   角度:線性 / 百葉窗 / 對開是前進方向(0 = 往右,90 = 往下);時鐘是起始角度(0 = 12 點鐘)
// direction:
//   線性:(範圍起點, 範圍終點),0..1。進度只在這個範圍內掃過(卡拉 OK 填色用它對齊文字左右邊界)
//   光圈 / 時鐘 / 菱形:(中心 X, 中心 Y),0..1
//   百葉窗 / 棋盤 / 噪點溶解 / 方塊崩落:(數量, 種子)。數量 = 條數 / 格數 / 噪點粗細
// 進度 0 = 完全沒擦(原圖),進度 1 = 完全擦完(全透明)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

const PI: f32 = 3.14159265;
const REVERSE_FLAG: u32 = 16u;

fn hash21(p: vec2f) -> f32 {
    var q = fract(p * vec2f(123.34, 456.21));
    q = q + dot(q, q + 45.32);
    return fract(q.x * q.y);
}

fn value_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2f(1.0, 0.0));
    let c = hash21(i + vec2f(0.0, 1.0));
    let d = hash21(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 沿角度方向的位置 0..1(角度 0 時 = 畫面 X 的比例)
fn along_direction(uv: vec2f) -> f32 {
    let angle = radians(uniforms.scalars.w);
    let dir = vec2f(cos(angle), sin(angle));
    let extent = abs(dir.x) + abs(dir.y);
    return clamp(0.5 + dot(uv - vec2f(0.5), dir) / max(extent, 0.0001), 0.0, 1.0);
}

// 以短邊為基準的正方形格子:回傳 (格子座標, 格內位置 0..1)
fn square_cells(uv: vec2f, count: f32) -> vec4f {
    let resolution = uniforms.resolution;
    let cell_size = min(resolution.x, resolution.y) / max(count, 1.0);
    let p = uv * resolution / cell_size;
    return vec4f(floor(p), fract(p));
}

// 種子 → 小範圍的偏移(直接乘大數會讓雜湊失去精度)
fn seed_offset() -> vec2f {
    let seed = uniforms.direction.y;
    return vec2f(fract(seed * 0.6180339), fract(seed * 0.4142136)) * 64.0;
}

// 回傳 0..1:這個像素會在進度走到多少時被擦掉(0 = 最先、1 = 最後)
fn sweep_position(uv: vec2f, base_mode: u32) -> f32 {
    let resolution = uniforms.resolution;
    if base_mode == 0u {
        let along = along_direction(uv);
        let range_start = uniforms.direction.x;
        let range_end = uniforms.direction.y;
        return clamp((along - range_start) / max(range_end - range_start, 0.0001), 0.0, 1.0);
    }
    if base_mode == 3u {
        let count = max(floor(uniforms.direction.x + 0.5), 1.0);
        return fract(along_direction(uv) * count * 0.9999);
    }
    if base_mode == 4u {
        // 棋盤:每格由左往右擦;奇數格晚半拍
        let cells = square_cells(uv, uniforms.direction.x);
        let parity = (i32(cells.x) + i32(cells.y)) & 1;
        return (cells.z + f32(parity)) * 0.5;
    }
    if base_mode == 6u {
        let scale = max(uniforms.direction.x, 1.0);
        let aspect = resolution.x / max(resolution.y, 1.0);
        let p = vec2f(uv.x * aspect, uv.y) * scale + seed_offset();
        let n = value_noise(p) * 0.65 + value_noise(p * 2.7 + 5.2) * 0.35;
        // 噪點值集中在中間,拉開到 0..1 讓進度分布平均一些
        return clamp((n - 0.2) / 0.6, 0.0, 1.0);
    }
    if base_mode == 7u {
        let cells = square_cells(uv, uniforms.direction.x);
        return hash21(cells.xy + seed_offset()) * 0.999;
    }
    if base_mode == 8u {
        return clamp(abs(along_direction(uv) - 0.5) * 2.0, 0.0, 1.0);
    }
    let center = uniforms.direction;
    let delta = (uv - center) * resolution;
    let corner_x = max(center.x, 1.0 - center.x) * resolution.x;
    let corner_y = max(center.y, 1.0 - center.y) * resolution.y;
    if base_mode == 1u {
        let farthest = max(length(vec2f(corner_x, corner_y)), 1.0);
        return clamp(length(delta) / farthest, 0.0, 1.0);
    }
    if base_mode == 5u {
        let farthest = max(corner_x + corner_y, 1.0);
        return clamp((abs(delta.x) + abs(delta.y)) / farthest, 0.0, 1.0);
    }
    // 時鐘:從 12 點鐘順時針,轉一圈 = 0..1
    let turn = atan2(delta.x, -delta.y) / (2.0 * PI);
    return fract(turn - uniforms.scalars.w / 360.0 + 1.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    let mode = u32(clamp(uniforms.scalars.x, 0.0, 31.0) + 0.5);
    let reversed = mode >= REVERSE_FLAG;
    let base_mode = select(mode, mode - REVERSE_FLAG, reversed);

    var t = sweep_position(input.tex_coord, base_mode);
    if reversed {
        t = 1.0 - t;
    }

    let progress = clamp(uniforms.scalars.y, 0.0, 1.0);
    let softness = clamp(uniforms.scalars.z, 0.0, 1.0) * 0.5 + 0.0001;
    // 讓進度 0 時邊緣在 0 以外、進度 1 時邊緣在 1 以外:兩端剛好是完全沒擦 / 完全擦完
    let edge = progress * (1.0 + softness);
    let keep = smoothstep(edge - softness, edge, t);

    // 合成器使用 premultiplied alpha,整個 rgba 一起乘即可
    return src * keep;
}
