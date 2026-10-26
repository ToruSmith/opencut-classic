struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 發光:取周圍亮部做模糊,再加回原圖(單次處理,三圈各 8 個取樣點)
// scalars   = (intensity [0..2], radius 像素, threshold [0..1], 0)
// direction = 未使用
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn bright_part(texel_value: vec4f, threshold: f32) -> vec3f {
    let rgb = select(vec3f(0.0), texel_value.rgb / texel_value.a, texel_value.a > 0.0001);
    let peak = max(rgb.r, max(rgb.g, rgb.b));
    let knee = max(1.0 - threshold, 0.0001);
    let weight = clamp((peak - threshold) / knee, 0.0, 1.0);
    // 回到預乘空間,透明的地方不會發光
    return rgb * weight * texel_value.a;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let intensity = uniforms.scalars.x;
    let radius = max(uniforms.scalars.y, 1.0);
    let threshold = clamp(uniforms.scalars.z, 0.0, 0.99);
    let texel = vec2f(1.0) / uniforms.resolution;
    let uv = input.tex_coord;

    let center = textureSample(input_texture, input_sampler, uv);
    var glow = bright_part(center, threshold);
    var total = 1.0;

    for (var ring = 1; ring <= 3; ring = ring + 1) {
        let ring_distance = radius * f32(ring) / 3.0;
        // 外圈權重較低,近似高斯衰減
        let weight = exp(-f32(ring * ring) / 4.5);
        for (var index = 0; index < 8; index = index + 1) {
            // 每圈錯開半格角度,減少十字狀的痕跡
            let angle = (f32(index) + 0.5 * f32(ring % 2)) * 0.78539816;
            let offset = vec2f(cos(angle), sin(angle)) * ring_distance * texel;
            glow = glow + bright_part(textureSample(input_texture, input_sampler, uv + offset), threshold) * weight;
            total = total + weight;
        }
    }

    glow = glow / total;
    // 發光可以延伸到原本透明的地方,所以 alpha 也要跟著增加
    let added = glow * intensity;
    let rgb = center.rgb + added;
    let alpha = clamp(max(center.a, max(added.r, max(added.g, added.b))), 0.0, 1.0);
    return vec4f(min(rgb, vec3f(alpha)), alpha);
}
