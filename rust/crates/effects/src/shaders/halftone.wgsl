struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 網點(半色調印刷風)。以旋轉後的格子取樣,每格畫一個圓點。
// scalars   = (格子大小 像素, 強度 0..1, 角度 度, 模式 0 = 黑白印刷 / 1 = 彩色圓點在黑底)
// direction = 未使用
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let size = max(uniforms.scalars.x, 2.0);
    let amount = clamp(uniforms.scalars.y, 0.0, 1.0);
    let angle = radians(uniforms.scalars.z);
    let colored = uniforms.scalars.w > 0.5;
    let resolution = uniforms.resolution;

    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    let pixel = input.tex_coord * resolution;
    let c = cos(angle);
    let s = sin(angle);
    // 轉到格子座標;格子中心再轉回畫面座標去取樣顏色
    let rot = vec2f(c * pixel.x + s * pixel.y, -s * pixel.x + c * pixel.y);
    let center_rot = (floor(rot / size) + vec2f(0.5)) * size;
    let local = rot - center_rot;
    let center_img = vec2f(c * center_rot.x - s * center_rot.y, s * center_rot.x + c * center_rot.y);
    let cell = textureSample(input_texture, input_sampler, clamp(center_img / resolution, vec2f(0.0), vec2f(1.0)));
    let cell_rgb = select(vec3f(0.0), cell.rgb / cell.a, cell.a > 0.0001);
    let luma = dot(cell_rgb, vec3f(0.2126, 0.7152, 0.0722));

    // 圓點面積正比於墨量;最大半徑剛好蓋住格子的對角線
    let ink = select(1.0 - luma, luma, colored);
    let radius = size * 0.7071 * sqrt(clamp(ink, 0.0, 1.0));
    let dot_mask = 1.0 - smoothstep(radius - 0.75, radius + 0.75, length(local));
    let printed = select(vec3f(1.0 - dot_mask), cell_rgb * dot_mask, colored);

    let straight = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);
    let rgb = mix(straight, printed, amount);
    return vec4f(rgb * src.a, src.a);
}
