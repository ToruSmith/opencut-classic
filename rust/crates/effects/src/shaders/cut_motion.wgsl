struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 轉場運動:平移 / 縮放 / 旋轉 + 方向模糊,畫面外用「鏡像延伸」補滿(不露黑邊)。
// 切點轉場(甩鏡、縮放衝入、旋轉甩入)用關鍵影格驅動,轉場以外的時間參數是中性值,前端不送 pass。
// scalars   = (平移 X 像素, 平移 Y 像素, 縮放倍率, 旋轉 度)
// direction = (模糊長度 像素, 模糊方向 度)
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

const MAX_TAPS: i32 = 32;

// 0..1 以外鏡像回來:1.2 → 0.8、-0.3 → 0.3
fn mirror_uv(uv: vec2f) -> vec2f {
    return vec2f(1.0) - abs(fract(uv * 0.5) * 2.0 - vec2f(1.0));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let resolution = uniforms.resolution;
    let offset = uniforms.scalars.xy;
    let scale = max(uniforms.scalars.z, 0.01);
    let angle = radians(uniforms.scalars.w);

    // 以畫面中心為原點的像素座標;內容往 +offset 移、轉 +angle、放大 scale,所以取樣點做反運算
    var p = input.tex_coord * resolution - resolution * 0.5 - offset;
    let c = cos(-angle);
    let s = sin(-angle);
    p = vec2f(c * p.x - s * p.y, s * p.x + c * p.y) / scale;

    let blur_length = max(uniforms.direction.x, 0.0);
    let blur_angle = radians(uniforms.direction.y);
    let blur_dir = vec2f(cos(blur_angle), sin(blur_angle)) * blur_length;
    // 取樣數依模糊長度決定(約每 3 像素一點),上限 32
    let taps = clamp(i32(ceil(blur_length / 3.0)), 1, MAX_TAPS);

    var color = vec4f(0.0);
    for (var index = 0; index < taps; index = index + 1) {
        let t = select(0.0, f32(index) / f32(max(taps - 1, 1)) - 0.5, taps > 1);
        let sample_pixel = p + blur_dir * t + resolution * 0.5;
        let uv = mirror_uv(sample_pixel / resolution);
        color = color + textureSampleLevel(input_texture, input_sampler, uv, 0.0);
    }
    return color / f32(taps);
}
