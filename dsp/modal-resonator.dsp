import("stdfaust.lib");

// ==========================================================================
// Modal Resonator — Dual-Bank Pair Architecture (2026-04-27 refactor)
// ==========================================================================
// 一个 voice 服务一对接触表面 (A 和 B),内部双 modal bank 并行,共享接触
// 激发,各自被对方 cross-damp,输出端相加再 spatializer。物理对应:
// 两个接触体各响各的 modal frequencies,接触面共同决定激发频谱,接触
// 把 A 的振动能量当 viscoelastic 损耗传给 B (viceversa)。
//
// 架构动机: spatializer (Steam Audio HRTF) 是 Quest 上的真瓶颈
// (project_steam_audio_hrtf_accumulation),DSP 内部多一个 modal bank 几乎
// 免费 (~16 个 IIR 状态),但每多一个 voice 就多一个 HRTF kernel 实例
// (单价 100×)。统一到一个 voice 让 impact + friction 都从同一份 spatializer
// 出去 — 比双源 impact 节省 50%,比双 friction voice 节省 50%。
//
// 物理保真度 (>10% 都建模,<10% 忽略,Mofei 钦定):
//   ✅ 各自 modal frequencies (双 bank)
//   ✅ Cross-damping (20-50% 效应,对硬-软材质对)
//   ✅ Newton 三定律: impulse / friction power 同时激发 A 和 B
//   ✅ Combined hardness/roughness 决定接触面噪声谱 (Hertzian 串联刚度 +
//      RSS 表面统计)
//   ❌ Mass loading 频率漂移 (~5%)
//   ❌ Mode coupling (重合频率才有,跨材质极少)
//   ❌ 高阶 multi-bounce 反射 (~10% of cross-damping)
//   ❌ Stick-slip dynamics
//   ❌ Frequency-dependent damping (per-mode ζ)


// ==========================================================================
// 1. UI 参数 — 接触动力学 (per-tick) + 一对材质 (alloc / runtime-switchable)
// ==========================================================================

// 1.1 冲击事件触发 (one-shot per OnCollisionEnter)
trig         = button("trig");
impact_force = hslider("impact_force", 0, 0, 10000, 0.1);
impact_vel   = hslider("impact_vel", 0, 0, 100, 0.001);

// 1.2 连续接触动力学 (per FixedUpdate tick)
gate           = hslider("gate", 0, 0, 1, 0.001);
tangent_vel    = hslider("tangent_vel", 0, 0, 1, 0.001);
normal_force   = hslider("normal_force", 0, 0, 1, 0.001);
friction_coeff = hslider("friction_coeff", 0.3, 0, 1, 0.001);

// 1.3 材料 A (this-side body — 谁拥有 voice 由 dual-CSM guard 决定)
//
// hf_damping (高频阻尼) — 0-1 perceptual scalar。控制高 mode T60 相对基模
//   下跌速率。从 v2 沿用,不严格对应 b1+b3·f² 物理(见 Section 8 注释)。
//   0      = 高模 T60 ≈ 基模 T60 (Steel/Glass,超长 metallic ring)
//   0.04   = Steel Plate 老配置,高模 78% 持续
//   0.3    = Wood (中等高频衰减)
//   0.7    = Concrete/Stone (高频快速衰减)
//   0.9+   = Rubber/Foam (几乎只剩基模)
//
// inharmonicity — 0-1 perceptual scalar。控制 modal partials 偏离 harmonic
//   ratio 的程度。也从 v2 沿用 (替代旧 stiffness 字段名,公式同 ratio_exp =
//   1 + 2.3·B - 2.6·B² 的 ad hoc 形式)。**不是** Fletcher 严格 stiff-string —
//   Fletcher 形式给的是 string/wire 拉伸 partials,我们要的 plate/bar 是压缩,
//   方向相反。当前公式在 B≈0.95 时给压缩 partials,匹配 bar-plate 物理直觉。
//   0      = 完全 harmonic (1, 2, 3, ...)
//   0.5    = 中等拉伸
//   0.95   = Steel Plate 老配置,partials 压缩 (1, 1.79, 2.51, ...)
freq_A          = hslider("freq_A", 400.0, 20.0, 8000.0, 1.0);
decay_A         = hslider("decay_A", 1.0, 0.01, 5.0, 0.01);
hf_damping_A    = hslider("hf_damping_A", 0.5, 0.0, 1.0, 0.001);
inharmonicity_A = hslider("inharmonicity_A", 0.1, 0.0, 1.0, 0.001);
tonality_A      = hslider("tonality_A", 0.8, 0.0, 1.0, 0.001);
hardness_A      = hslider("hardness_A", 0.8, 0.0, 1.0, 0.001);
roughness_A     = hslider("roughness_A", 0.5, 0.0, 1.0, 0.001);

// 1.4 材料 B (other-side body — 由 collision.gameObject 上的 SoundMaterial 决定)
freq_B          = hslider("freq_B", 400.0, 20.0, 8000.0, 1.0);
decay_B         = hslider("decay_B", 1.0, 0.01, 5.0, 0.01);
hf_damping_B    = hslider("hf_damping_B", 0.5, 0.0, 1.0, 0.001);
inharmonicity_B = hslider("inharmonicity_B", 0.1, 0.0, 1.0, 0.001);
tonality_B      = hslider("tonality_B", 0.8, 0.0, 1.0, 0.001);
hardness_B      = hslider("hardness_B", 0.8, 0.0, 1.0, 0.001);
roughness_B     = hslider("roughness_B", 0.5, 0.0, 1.0, 0.001);

// 1.5 Cross-damping 耦合强度
//   0    = 独立振动 (无接触损耗)
//   0.3  = 默认,典型 hand-grip 中段 — Steel+Skin 接触中 decay 1.8→0.26s
//   1    = 强耦合 (类似刚性焊接接触)
cd_alpha = hslider("cd_alpha", 0.3, 0.0, 1.0, 0.001);


// ==========================================================================
// 2. 接触面 pair 共有属性 (Stage 0)
// ==========================================================================

// Hertzian 接触刚度 — 谐波平均,对应"两个弹性体串联接触刚度"。较软的
// 主导接触刚度 → 决定 impact 频谱 brightness 和 friction asperity 碰撞峰锐度。
combined_hardness = 2.0 * hardness_A * hardness_B / (hardness_A + hardness_B + 0.001);

// 表面粗糙度组合 — 独立随机表面 RMS 的 RSS (root-sum-square)。
// 物理: 两个独立粗糙表面的 asperity 高度分布相加,combined std =
// √(σ_A² + σ_B²)。在 [0,1] 标量抽象下平方再开方再 clamp。
combined_roughness = min(1.0, sqrt(roughness_A * roughness_A + roughness_B * roughness_B));


// ==========================================================================
// 3. 平滑 (Stage 1) — 防 click on 50Hz tick boundaries
// ==========================================================================
s_gate           = gate           : si.smooth(ba.tau2pole(0.015));
s_tangent_vel    = tangent_vel    : si.smooth(ba.tau2pole(0.01));
s_normal_force   = normal_force   : si.smooth(ba.tau2pole(0.01));
s_friction_coeff = friction_coeff : si.smooth(ba.tau2pole(0.01));


// ==========================================================================
// 4. 冲击激发器 (Stage 2a) — 用 combined_hardness 决定频谱
// ==========================================================================
// 物理: F (impulse/dt) × v (相对速度) 是统一的 v-linear (asperity) 形式
// — amp ∝ √F · v = √(单次碰撞峰值力) × asperity 碰撞率。impact 与 friction
// 数学同构 (vision lock,feedback_audio_physics_symmetry)。
//
// 接触刚度 (combined_hardness) 决定应力波上沿陡度 → 频谱亮度。两个表面
// 都参与决定接触刚度 → harmonic mean 的 combined value 才物理对。
attack  = 0.0005;
release = 0.001 + (1.0 - combined_hardness) * 0.02;
env     = en.ar(attack, release, trig);

// T_AB 进 cutoff 的 hardness 项 — Hertzian 物理:软接触拉长力脉冲 → 高频损失,
// 低频不变。500 Hz 基底保留所以基模激发跨 mismatch 不变,combined_hardness × 8000
// 这项随 T_AB 衰减让高频随 impedance mismatch 暗下来。
// Steel-Steel (T=1): cutoff 不变。Steel-Skin (T=0.26): cutoff 从 7080 → 3743 Hz。
// Steel-Rubber (T=0.012): cutoff 暴跌到 ~2.6 kHz,几乎只剩基模 — "thud"。
cutoff_imp_raw = 500.0 + combined_hardness * 8000.0 * T_AB + pow(impact_vel, 0.5) * 1200.0;
cutoff_imp     = min(ma.SR / 2.1, cutoff_imp_raw);

// amp = √(F·v) = √(mechanical power dissipated). Was previously v·√F which
// gave amp ∝ v¹·F^0.5 instead of v^0.5·F^0.5 — overweighted velocity, so
// gentle taps (low v) dropped below the audibility floor multiplicatively
// even when force was meaningful (2026-04-29 fix).
impact_exciter = no.noise * env * sqrt(impact_force * impact_vel) : fi.lowpass(2, cutoff_imp);


// ==========================================================================
// 5. 摩擦 (持续接触) 激发器 (Stage 2b) — 用 combined hardness + roughness
// ==========================================================================
// 物理: 微观 asperity 间随机碰撞序列。
//   amp = slip · √(N·μ) · gate · η_AB
//     slip       — asperity 碰撞频率 (slip velocity)
//     √(N·μ)     — 单次碰撞峰值力 (摩擦力)
//     η_AB       — 接触面声辐射效率 (∝ combined_roughness,3-23% 物理范围)
//   am_mod 模拟离散 asperity 碰撞的随机时间结构 (低速颗粒 → 高速嘶嘶)。

mod_rate  = 40 + s_tangent_vel * 3000;
mod_depth = max(0.05, 0.8 - s_tangent_vel * 0.2) * (0.4 + combined_roughness * 0.6);
am_mod    = 1.0 - mod_depth * max(0, no.noise : fi.lowpass(1, mod_rate));

// 同 impact 的处理:T_AB 进 cutoff 的 hardness 项,反映 mismatch 让 friction
// 高频损失。combined_roughness × 4000 的 asperity 噪声宽频项不动(粗糙度直接
// 决定 surface noise 频谱,和 impedance 无关)。
cont_cutoff = min(ma.SR / 2.1,
    500 + combined_hardness * 6000 * T_AB + combined_roughness * 4000
        + s_tangent_vel * 6000 + sqrt(s_normal_force) * 1500);

// eta = 声辐射效率,纯 perceptual scalar 由 combined_roughness 决定。不再乘 T_AB
// (那是 amp 影响,留给 cutoff 处理高频损失就够了)。
eta_AB   = 0.03 + combined_roughness * 0.2;
cont_amp = s_tangent_vel * sqrt(s_normal_force * s_friction_coeff) * s_gate * eta_AB;

continuous_exciter = no.noise * cont_amp * am_mod : fi.lowpass(2, cont_cutoff);


// ==========================================================================
// 6. 统一激发器 + master_gain (Stage 3)
// ==========================================================================
// Master gain — 整个 DSP 的唯一经验常数。Both impact 和 friction 共享,无
// per-type trim (vision lock)。当前 0.012 是 single-bank 时代调的;dual-bank
// 输出自然 +3~6 dB,听感测试后可能微调到 0.008-0.010。
//
// History:
//   0.015  组 2 baseline (√(P_mech) form)
//   0.0075 04-24 day  (v-linear,impact 2× growth at v=4)
//   0.012  04-24 night (v=1-2 typical,补 eta widen 0.02-0.12 → 0.03-0.23)
master_gain = 0.012;
exciter = (impact_exciter + continuous_exciter) * master_gain;


// ==========================================================================
// 7. Cross-damping (Stage 4) — impedance-aware 接触能量转移
// ==========================================================================
// 物理: 两个固体接触面是应力波的边界。波从 A 侧打过来时一部分反射回 A,
// 一部分透射进 B。透射这部分就是 A 损失给接触的能量,被 B 自己的 damping
// 转成热。透射比例由两侧的机械阻抗决定:
//
//   T_AB = 4·Z_A·Z_B / (Z_A + Z_B)²    (acoustic/mechanical transmission)
//
//   Z_A = Z_B 匹配 (e.g. 钢-钢):     T = 1,能量全过 → 强耦合
//   Z_A ≫ Z_B 悬殊 (e.g. 钢-皮肤):   T → 0,大部分反射 → 钢几乎独立振动
//   对称: T_AB = T_BA
//
// 真实 Z = √(ρ·E)。我们 0-1 抽象里没有 density 维度,只能近似:
//
//   Z ≈ hardness³
//
// 立方是补偿因子 — 钢/皮肤真实 Z ratio 12000:1,光用 hardness¹ 只有 2.4:1
// (钢 0.95 vs 皮肤 0.4),mismatch 几乎被抹平。立方拉到 13:1,T_AB ≈ 0.26
// 符合 "钢碰皮肤大部分能量反射" 的物理直觉。
//
// damping ratio 加性: ζ_A_eff = ζ_A + α · gate · T_AB · ζ_B
//   (能量先 T_AB 比例传到 B,再被 B 的 ζ_B 耗散 — 串联两步)
// decay 与 damping 反比: decay_eff = decay × (damping / damping_eff)
//
// alpha=0.3, k=3 数值演练:
//   Steel + Skin       T=0.26,  d_eff_steel=0.10, decay 1.8→0.71s   ✓ metallic
//   Steel + Steel      T=1.0,   d_eff_steel=0.052,decay 1.8→1.38s   ✓ 匹配强耦合
//   Oak + Skin         T=0.81,  d_eff_oak=0.49,   decay 0.8→0.49s
//   Plastic + Skin     T=0.61,  d_eff_plastic=0.55,decay 0.3→0.22s
//   Stone + Skin       T=0.34,  d_eff_stone=0.68, decay 0.4→0.35s
//   Rubber + Steel     T=0.012, 几乎独立 (橡胶高阻+硬度低,匹配差)
//
// 替换了原 contact_damp = 1 - s_gate * 0.7 (uniform 30% decay during contact)
// 和上一版 simple linear (damping_A + α·damping_B,无 mismatch 因子)。
// Impedance proxy + transmission coefficient — used by impact/friction cutoffs
// (Hertzian wave-mechanical regime,见 Section 4 + 5)。**不**用于 cross-damping
// 因为 sustained contact 的 modal decay 是 bulk viscoelastic damping(低频
// quasi-static regime),不依赖波透射效率。Rubber 软地物理上就是靠它自己的
// bulk damping 吸 Steel 的能量,T_AB 不该 gate 这个过程。
Z_A_imp = pow(hardness_A, 3.0);
Z_B_imp = pow(hardness_B, 3.0);
T_AB    = 4.0 * Z_A_imp * Z_B_imp / pow(Z_A_imp + Z_B_imp + 0.001, 2.0);

// Cross-damping: 直接按 B 的 bulk damping 比例,T_AB 不参与。
// 软材料(rubber 0.85, skin 0.8)→ 强 cross-damping → Steel 接触中 ring 短。
// 硬材料(steel 0.04)→ 弱 cross-damping → Steel 长 ring(匹配体不互相 drain)。
hf_damping_eff_A = hf_damping_A + s_gate * cd_alpha * hf_damping_B;
hf_damping_eff_B = hf_damping_B + s_gate * cd_alpha * hf_damping_A;
// decay 反比 damping 缩短
decay_eff_A      = decay_A * hf_damping_A / hf_damping_eff_A;
decay_eff_B      = decay_B * hf_damping_B / hf_damping_eff_B;


// ==========================================================================
// 8. 模态共振库 — 参数化 (Stage 5)
// ==========================================================================
// 每 bank 16 modes,partials 由 stiffness 决定 (ratio_exp),T60_i 由 decay
// 和 frequency rolloff (damping_exp) 决定,Q 由 tonality 调,gain 1/√(i+1)
// rolloff。和原 single-bank 同构,只是参数 set 由 caller 传。

N = 16;

// Partial spread 公式(同 v2 ad hoc 形式,只是字段从 stiffness 改名 inharmonicity):
//   ratio_exp = 1 + 2.3·B - 2.6·B²
//   Ratio_i  = pow(i+1, ratio_exp)
//   B=0    → ratio_exp=1.0 → harmonic 1, 2, 3, ...
//   B=0.5  → ratio_exp=1.5 → 拉伸 partials (1, 2.83, 5.20, ...)
//   B=0.95 → ratio_exp=0.84 → 压缩 partials (1, 1.79, 2.51, ...) bar/plate-like
// 注意:这不是 Fletcher stiff-string 公式 — Fletcher 给的是 string/wire 拉伸,
// 我们这里要 plate/bar 压缩,所以保留 ad hoc 公式覆盖 stretch + compression 两端。
//
// T60 频率依赖公式(同 v2 power-law,字段从 damping 改名 hf_damping):
//   damping_exp = hf_damping × 3   (0-3 effective range)
//   T60_i = decay × (freq/Fi)^damping_exp
//   hf_damping=0    → exp=0 → T60_i = decay (所有 mode 同 T60,超 metallic)
//   hf_damping=0.04 → exp=0.12 → 高模 T60 ≈ 78%×decay (Steel 老配置)
//   hf_damping=0.7  → exp=2.1 → 高模快速衰减 (Concrete-like)
// 注意:这不严格遵循 b1+b3·f² loss factor 物理,但 perceptually 调校好,
// 给"金属感"sustained metallic ring。物理纯模型给 T60∝1/f,听上去不 metallic。

mode(i, freq, decay, hf_damping, inharmonicity, tonality) = fi.resonbp(Fi, Qi, Gain_i)
with {
    ratio_exp   = 1.0 + 2.3 * inharmonicity - 2.6 * inharmonicity * inharmonicity;
    damping_exp = hf_damping * 3.0;

    Ratio_i = pow(i + 1.0, ratio_exp);
    Fi_raw  = freq * Ratio_i;
    Fi      = min(ma.SR / 2.1, max(20.0, Fi_raw));

    T60_i   = decay * pow(max(0.001, freq / Fi), damping_exp);

    Q_base  = (Fi * T60_i) / 6.91;
    Qi      = max(0.5, Q_base * tonality + 2.0 * (1.0 - tonality));

    Gain_i  = 1.0 / pow(i + 1.0, 0.5);
};

modal_bank_for(freq, decay, hf_damping, inharmonicity, tonality) =
    _ <: sum(i, N, mode(i, freq, decay, hf_damping, inharmonicity, tonality));


// ==========================================================================
// 9. 漫反射质感层 — 参数化 (Stage 5 同侧,4 inharmonic modes)
// ==========================================================================
// 每材质各自的高频纹理 — Skin 高频 ≠ Steel 高频。合并会丢材质区分。

N_diffuse = 4;

diffuse_mode(j, freq, tonality) = fi.resonbp(Fd_j, Qd, 1.0)
with {
    d_ratio_j = ba.take(j + 1, (1.7, 3.3, 5.7, 9.1));
    Fd_j      = min(ma.SR / 2.1, max(20.0, freq * d_ratio_j));
    Qd        = 1.5 + tonality * 2.0;
};

diffuse_bank_for(freq, tonality) =
    _ <: sum(j, N_diffuse, diffuse_mode(j, freq, tonality)) : _ * ((1.0 - tonality) * 0.5);


// ==========================================================================
// 10. 双 bank 并行 + 输出 (Stages 6 & 7)
// ==========================================================================
// 同一 exciter 信号 fan-out 给 A 侧和 B 侧,各自 modal + diffuse,输出端相加,
// tanh 软限幅,mono 复制成 stereo (spatializer 期望 mono 输入,会把 mono 转
// 立体声 HRTF)。整个 voice 一份 spatializer 实例。

// modal_bank_for 接 hf_damping_A/B 而**不是** _eff 版本 — 因为 hf_damping
// 在 modal bank 里同时驱动 decay_eff_A(已经在外面算好传 decay_eff_A 了)
// 和 damping_exp(高频 rolloff 形状)。decay 缩短是 cross-damping 该做的,
// 但**改高频 rolloff 是另一回事** — 那是材料 A 自身的 viscoelastic 特性,
// 不该因 B 的接触翻 7 倍。具体讲:Steel 自己 rolloff 0.12 让高频 ring 76%
// of 基模,接触 skin 后用 _eff(0.84)会让高频只剩 41% → 失去 metallic 感。
// 让 cross-damping **只改 decay**(decay_eff_A),不动 damping_exp。
side_A = modal_bank_for(freq_A, decay_eff_A, hf_damping_A, inharmonicity_A, tonality_A) +
         diffuse_bank_for(freq_A, tonality_A);

side_B = modal_bank_for(freq_B, decay_eff_B, hf_damping_B, inharmonicity_B, tonality_B) +
         diffuse_bank_for(freq_B, tonality_B);

process = exciter <: side_A, side_B :> ma.tanh <: _, _;
