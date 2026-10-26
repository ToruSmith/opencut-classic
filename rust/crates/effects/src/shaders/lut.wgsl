struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 3D LUT 調色(.cube,類似 Kdenlive / Shotcut / DaVinci 的 Apply LUT)
// scalars   = (LUT 邊長 N, 每列幾格 cols, 共幾列 rows, 強度 0..1)
// direction = 未使用
// group(2)  = LUT 貼圖:N 張 N×N 的切片(藍色由小到大)排成 cols × rows 的格子,
//             切片內 x = 紅、y = 綠。貼圖大小 (cols·N) × (rows·N)。
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;
@group(2) @binding(0) var lut_texture: texture_2d<f32>;
@group(2) @binding(1) var lut_sampler: sampler;

// 切片內的座標落在格點中心之間,雙線性取樣不會跨到隔壁切片
fn lut_uv(red_green: vec2f, slice: f32, n: f32, cols: f32, rows: f32) -> vec2f {
    let tile = vec2f(slice % cols, floor(slice / cols));
    let texel = tile * n + red_green * (n - 1.0) + vec2f(0.5);
    return texel / vec2f(cols * n, rows * n);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let n = max(uniforms.scalars.x, 2.0);
    let cols = max(uniforms.scalars.y, 1.0);
    let rows = max(uniforms.scalars.z, 1.0);
    let intensity = clamp(uniforms.scalars.w, 0.0, 1.0);

    let color = textureSample(input_texture, input_sampler, input.tex_coord);
    let straight = clamp(
        select(vec3f(0.0), color.rgb / color.a, color.a > 0.0001),
        vec3f(0.0),
        vec3f(1.0),
    );

    // 紅綠靠貼圖的雙線性內插,藍色在兩張相鄰切片之間手動內插 → 三線性
    let blue = straight.b * (n - 1.0);
    let slice0 = floor(blue);
    let slice1 = min(slice0 + 1.0, n - 1.0);
    let t = blue - slice0;
    let low = textureSample(lut_texture, lut_sampler, lut_uv(straight.rg, slice0, n, cols, rows)).rgb;
    let high = textureSample(lut_texture, lut_sampler, lut_uv(straight.rg, slice1, n, cols, rows)).rgb;
    let graded = mix(low, high, t);

    let rgb = mix(straight, graded, intensity);
    return vec4f(rgb * color.a, color.a);
}
