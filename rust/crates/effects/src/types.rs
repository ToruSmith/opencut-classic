use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct EffectPass {
    pub shader: String,
    pub uniforms: HashMap<String, UniformValue>,
    /// 第二張輸入貼圖(例如 LUT)。需要它的 shader 沒拿到時,該 pass 會被略過、原圖照常輸出。
    pub texture: Option<wgpu::Texture>,
}

#[derive(Clone, Debug)]
pub enum UniformValue {
    Number(f32),
    Vector(Vec<f32>),
}
