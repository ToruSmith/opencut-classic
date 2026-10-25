struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// scalars   = (temperature [-1..1], tint [-1..1], shadows [-1..1], highlights [-1..1])
// direction = (exposure in EV [-2..2], fade [0..1])
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let src = textureSample(input_texture, input_sampler, input.tex_coord);
    var rgb = select(vec3f(0.0), src.rgb / src.a, src.a > 0.0001);

    // 曝光(以 EV 為單位)
    rgb = rgb * exp2(uniforms.direction.x);

    // 色溫:正值偏暖(加紅減藍);色調:正值偏綠,負值偏洋紅
    let temperature = uniforms.scalars.x;
    let tint = uniforms.scalars.y;
    rgb = rgb + vec3f(temperature * 0.10, 0.0, -temperature * 0.10);
    rgb = rgb + vec3f(-tint * 0.04, tint * 0.08, -tint * 0.04);

    // 陰影只影響暗部、亮部只影響亮部
    let l = luma(rgb);
    let shadow_weight = 1.0 - smoothstep(0.0, 0.5, l);
    let highlight_weight = smoothstep(0.5, 1.0, l);
    rgb = rgb + vec3f(uniforms.scalars.z * 0.25 * shadow_weight);
    rgb = rgb + vec3f(uniforms.scalars.w * 0.25 * highlight_weight);

    // 褪色:墊高黑色、壓低白色,有底片的感覺
    let fade = uniforms.direction.y;
    rgb = rgb * (1.0 - fade * 0.25) + vec3f(fade * 0.08);

    rgb = clamp(rgb, vec3f(0.0), vec3f(1.0));
    return vec4f(rgb * src.a, src.a);
}
