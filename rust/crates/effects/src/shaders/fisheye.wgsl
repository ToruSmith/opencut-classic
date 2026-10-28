struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

// 魚眼 / 鏡頭畸變:強度 > 0 是桶狀(中間鼓、邊緣被壓),< 0 是枕狀。
// scalars   = (強度 -1..1, 放大 1..2(把邊緣推出畫面,減少鏡像延伸), 0, 0)
// direction = 未使用
struct EffectUniforms {
    resolution: vec2f,
    direction: vec2f,
    scalars: vec4f,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;

fn mirror_uv(uv: vec2f) -> vec2f {
    return vec2f(1.0) - abs(fract(uv * 0.5) * 2.0 - vec2f(1.0));
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let strength = clamp(uniforms.scalars.x, -1.0, 1.0);
    let zoom = max(uniforms.scalars.y, 0.1);
    let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);

    // 以角落為 1 的半徑,畫面比例不同時畸變仍是圓對稱
    var p = (input.tex_coord - vec2f(0.5)) * 2.0;
    p.x = p.x * aspect;
    let r2 = dot(p, p) / (aspect * aspect + 1.0);
    var q = p * (1.0 + strength * r2) / zoom;
    q.x = q.x / aspect;
    let uv = mirror_uv(q * 0.5 + vec2f(0.5));
    return textureSample(input_texture, input_sampler, uv);
}
