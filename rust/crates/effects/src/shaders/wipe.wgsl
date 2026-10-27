struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 擦除(線性 / 圓形光圈 / 時鐘),把圖層擦成透明,露出下面的畫面。轉場用:progress 做 0 → 1 的關鍵影格。
// scalars   = (模式, 進度 0..1, 柔邊 0..1, 角度 度)
//   模式 0 = 線性、1 = 圓形光圈、2 = 時鐘;加 3 = 反向(線性反向掃、光圈由外往內、時鐘逆時針)
//   角度:線性是擦除前進的方向(0 = 往右,90 = 往下);時鐘是起始角度(0 = 12 點鐘)
// direction = 光圈 / 時鐘:(中心 X, 中心 Y);線性:(範圍起點, 範圍終點),都是 0..1。
//   線性的範圍是沿前進方向的位置(角度 0 時就是畫面 X 的比例):進度只在這個範圍內掃過,範圍外直接視為起點 / 終點。
//   (0, 1) = 整個畫面。卡拉 OK 填色用它讓進度剛好對應文字的左右邊界
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

// 回傳 0..1:這個像素會在進度走到多少時被擦掉(0 = 最先、1 = 最後)
fn sweep_position(uv: vec2f, base_mode: u32) -> f32 {
    let resolution = uniforms.resolution;
    let angle = radians(uniforms.scalars.w);
    if base_mode == 0u {
        let dir = vec2f(cos(angle), sin(angle));
        let extent = abs(dir.x) + abs(dir.y);
        let along = clamp(0.5 + dot(uv - vec2f(0.5), dir) / max(extent, 0.0001), 0.0, 1.0);
        let range_start = uniforms.direction.x;
        let range_end = uniforms.direction.y;
        return clamp((along - range_start) / max(range_end - range_start, 0.0001), 0.0, 1.0);
    }
    let center = uniforms.direction;
    let delta = (uv - center) * resolution;
    if base_mode == 1u {
        let corner_x = max(center.x, 1.0 - center.x) * resolution.x;
        let corner_y = max(center.y, 1.0 - center.y) * resolution.y;
        let farthest = max(length(vec2f(corner_x, corner_y)), 1.0);
        return clamp(length(delta) / farthest, 0.0, 1.0);
    }
    // 時鐘:從 12 點鐘順時針,轉一圈 = 0..1
    let turn = atan2(delta.x, -delta.y) / (2.0 * PI);
    return fract(turn - uniforms.scalars.w / 360.0 + 1.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    let mode = u32(clamp(uniforms.scalars.x, 0.0, 5.0) + 0.5);
    let reversed = mode >= 3u;
    let base_mode = select(mode, mode - 3u, reversed);

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
