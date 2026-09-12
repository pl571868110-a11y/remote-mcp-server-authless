# -*- coding: utf-8 -*-
"""
Инженерные расчёты (предварительные) для чернового комплекта КЖ
"убежище 3.0х4.0" — Русановские сады, Киев.

ВНИМАНИЕ: все расчёты в этом модуле являются ПРЕДВАРИТЕЛЬНЫМИ.
Они выполнены при отсутствии инженерной геологии, УГВ, нагрузок и
класса защиты и НЕ ЗАМЕНЯЮТ расчёт лицензированного инженера-конструктора.
"""
import math

DISCLAIMER = ("Черновой инженерный комплект. Не является рабочим КЖ-проектом и не "
              "предназначен для выполнения строительных работ без проверки, "
              "корректировки и выпуска лицензированным инженером-конструктором.")

PROJECT_DATE = "12.09.2026"
PROJECT_NAME = "Полностью подземное гражданское укрытие 3,0х4,0 м (в свету)"
PROJECT_LOCATION = "г. Киев, Русановские сады (частный участок)"

# --------------------------------------------------------------------------
# 1. ГЕОМЕТРИЯ (мм, если не указано иное)
# --------------------------------------------------------------------------
IN_L, IN_W, IN_H = 4000, 3000, 2200          # внутренние размеры (свет)
WALL_T = 300                                   # толщина стен
TOP_SLAB_T = 400                               # толщина верхней плиты
BOT_SLAB_T = 350                               # толщина нижней плиты (сценарий A)
BOT_SLAB_T_B = 400                             # сценарий B (усиленная плита)
SOIL_OVER_TOP = 100                             # грунт над верхней плитой

OUT_L = IN_L + 2 * WALL_T                       # 4600
OUT_W = IN_W + 2 * WALL_T                       # 3600

TOTAL_DEPTH = SOIL_OVER_TOP + TOP_SLAB_T + IN_H + BOT_SLAB_T   # 3050 мм (сценарий A)

ENTRY_OPENING = 900                              # проём входа, мм
HATCH = (800, 800)                               # аварийный люк, мм

assert OUT_L == 4600 and OUT_W == 3600, "Несоответствие наружных размеров ТЗ!"
assert TOTAL_DEPTH == 3050, "Несоответствие суммарной глубины ТЗ!"

# --------------------------------------------------------------------------
# 2. МАТЕРИАЛЫ
# --------------------------------------------------------------------------
CONCRETE_CLASS = "C35/45"
CONCRETE_W = "W12"
CONCRETE_F = "F200"
REBAR_CLASS = "A500C"
REBAR_DENSITY = {12: 0.888, 14: 1.208, 16: 1.578}   # кг/м (справочно, ДСТУ)
STEEL_KG_M3 = 7850.0
CONCRETE_KG_M3 = 2500.0
WATER_KG_M3 = 1000.0

# --------------------------------------------------------------------------
# 3. ОБЪЁМЫ БЕТОНА (м3) — основной короб считается по укрупнённой методике:
#    плиты по полному наружному отпечатку, стены по площади в плане х чистую высоту
# --------------------------------------------------------------------------
m2 = lambda mm_l, mm_w: (mm_l / 1000.0) * (mm_w / 1000.0)

area_out = m2(OUT_L, OUT_W)          # 16.56 м2
area_in = m2(IN_L, IN_W)             # 12.00 м2
area_walls_plan = area_out - area_in # 4.56 м2

vol_walls = area_walls_plan * (IN_H / 1000.0)         # м3
vol_top_slab = area_out * (TOP_SLAB_T / 1000.0)        # м3
vol_bot_slab_A = area_out * (BOT_SLAB_T / 1000.0)      # м3 (350мм)
vol_bot_slab_B = area_out * (BOT_SLAB_T_B / 1000.0)    # м3 (400мм)

vol_main_box_A = vol_walls + vol_top_slab + vol_bot_slab_A
vol_main_box_B = vol_walls + vol_top_slab + vol_bot_slab_B

# Входная шахта и аварийная шахта — укрупнённо (предварительно!)
vol_entry_shaft = 1.80    # м3, предварительно
vol_emerg_shaft = 0.90    # м3, предварительно
vol_reserve = 0.85         # м3, технологический запас/потери

vol_total_order_A = vol_main_box_A + vol_entry_shaft + vol_emerg_shaft + vol_reserve

CONCRETE_TABLE = {
    "Нижняя плита (сцен. A, 350мм)": round(vol_bot_slab_A, 3),
    "Нижняя плита (сцен. B, 400мм)": round(vol_bot_slab_B, 3),
    "Стены (h=2200мм)": round(vol_walls, 3),
    "Верхняя плита (400мм)": round(vol_top_slab, 3),
    "Входная шахта (предв.)": vol_entry_shaft,
    "Аварийная шахта (предв.)": vol_emerg_shaft,
    "Технологический резерв": vol_reserve,
}

# --------------------------------------------------------------------------
# 4. АРМАТУРА
# --------------------------------------------------------------------------
def n_bars(length_mm, spacing_mm):
    """число стержней с шагом spacing по длине length (обе крайние линии включены)"""
    return int(round(length_mm / spacing_mm)) + 1

# --- 4.1 Стены Ø12/150, две сетки (наружная+внутренняя), верт.+гориз. ---
wall_cl_L = OUT_L - WALL_T   # осевая линия по контуру стен (по центру стены)
wall_cl_W = OUT_W - WALL_T
wall_perimeter = 2 * (wall_cl_L + wall_cl_W)          # мм, по центру стен

vert_bar_len = IN_H + 2 * 300     # чистая высота + анкеровка в плиты по 300мм с каждой стороны (предв.)
n_vert_per_layer = n_bars(wall_perimeter, 150)
n_vert_layers = 2                   # наружная + внутренняя сетка
n_vert_total = n_vert_per_layer * n_vert_layers
len_vert_total_m = n_vert_total * vert_bar_len / 1000.0

horiz_bar_len = wall_perimeter + 300   # периметр + нахлёст (предв.)
n_horiz_per_layer = n_bars(IN_H, 150)
n_horiz_layers = 2
n_horiz_total = n_horiz_per_layer * n_horiz_layers
len_horiz_total_m = n_horiz_total * horiz_bar_len / 1000.0

len_walls_d12_m = len_vert_total_m + len_horiz_total_m
mass_walls_d12_kg = len_walls_d12_m * REBAR_DENSITY[12]

# --- 4.2 Верхняя плита Ø14/150х150, верх+низ ---
def mesh_bars(span_a_mm, span_b_mm, spacing_mm):
    """сетка Ø.. /spacing x spacing на прямоугольнике a x b:
    стержни направления 'a' (длина b) и направления 'b' (длина a)"""
    n_dir_a = n_bars(span_b_mm, spacing_mm)   # число стержней, идущих вдоль a, расставленных по b
    n_dir_b = n_bars(span_a_mm, spacing_mm)
    len_dir_a = n_dir_a * span_a_mm / 1000.0
    len_dir_b = n_dir_b * span_b_mm / 1000.0
    return n_dir_a, n_dir_b, len_dir_a, len_dir_b

n_top_a, n_top_b, l_top_a, l_top_b = mesh_bars(OUT_L, OUT_W, 150)
len_top_slab_1mesh_m = l_top_a + l_top_b
n_top_slab_1mesh = n_top_a + n_top_b
# верх + низ = 2 сетки
len_top_slab_d14_m = len_top_slab_1mesh_m * 2
n_top_slab_d14 = n_top_slab_1mesh * 2
mass_top_slab_d14_kg = len_top_slab_d14_m * REBAR_DENSITY[14]

# --- 4.3 Нижняя плита Ø14/150х150, верх+низ (сценарий A) ---
n_bot_a, n_bot_b, l_bot_a, l_bot_b = mesh_bars(OUT_L, OUT_W, 150)
len_bot_slab_1mesh_m = l_bot_a + l_bot_b
n_bot_slab_1mesh = n_bot_a + n_bot_b
len_bot_slab_d14_m = len_bot_slab_1mesh_m * 2
n_bot_slab_d14 = n_bot_slab_1mesh * 2
mass_bot_slab_d14_kg = len_bot_slab_d14_m * REBAR_DENSITY[14]

# --- 4.4 Местное усиление проёмов Ø16 (вход + люк), предварительно ---
n_reinf_openings = 4 * 2         # по 4 стержня на проём (вход, люк)
len_reinf_bar_m = 1.5
len_openings_d16_m = n_reinf_openings * len_reinf_bar_m
mass_openings_d16_kg = len_openings_d16_m * REBAR_DENSITY[16]

# --- 4.5 Дополнительно: угловые Г- и П-образные элементы, монтажная арматура, запас ---
mass_corner_extra_kg = 0.08 * mass_walls_d12_kg    # 8% на угловые/доборные элементы (предв.)
mass_install_extra_kg = 0.03 * (mass_walls_d12_kg + mass_top_slab_d14_kg + mass_bot_slab_d14_kg)  # монтажная 3%
mass_reserve_kg = 0.05 * (mass_walls_d12_kg + mass_top_slab_d14_kg + mass_bot_slab_d14_kg
                          + mass_openings_d16_kg + mass_corner_extra_kg + mass_install_extra_kg)  # запас 5%

mass_d12_total_kg = mass_walls_d12_kg + mass_corner_extra_kg
mass_d14_total_kg = mass_top_slab_d14_kg + mass_bot_slab_d14_kg
mass_d16_total_kg = mass_openings_d16_kg
mass_install_kg = mass_install_extra_kg
mass_reserve_total_kg = mass_reserve_kg

mass_rebar_total_kg = (mass_d12_total_kg + mass_d14_total_kg + mass_d16_total_kg
                        + mass_install_kg + mass_reserve_total_kg)
mass_rebar_total_t = mass_rebar_total_kg / 1000.0

REBAR_TABLE = {
    "Ø12 A500C (стены + доборные)": {"len_m": round(len_walls_d12_m, 1), "mass_kg": round(mass_d12_total_kg, 1)},
    "Ø14 A500C (плиты верх+низ)": {"len_m": round(len_top_slab_d14_m + len_bot_slab_d14_m, 1), "mass_kg": round(mass_d14_total_kg, 1)},
    "Ø16 A500C (усиление проёмов)": {"len_m": round(len_openings_d16_m, 1), "mass_kg": round(mass_d16_total_kg, 1)},
    "Монтажная арматура (~3%)": {"len_m": None, "mass_kg": round(mass_install_kg, 1)},
    "Запас (~5%)": {"len_m": None, "mass_kg": round(mass_reserve_total_kg, 1)},
}

# --------------------------------------------------------------------------
# 5. ПРОВЕРКА НА ВСПЛЫТИЕ (упрощённо, предварительно)
#    Худший случай: УГВ = уровень земли (грунт над плитой сохраняет вес,
#    но при высоком УГВ его удерживающий эффект неопределён без геологии
#    -> считаем ДВА варианта: с учётом грунта над плитой и без него)
# --------------------------------------------------------------------------
G = 9.81

def buoyancy_check(bot_slab_t_mm, include_soil_weight=True):
    total_h_m = (SOIL_OVER_TOP + TOP_SLAB_T + IN_H + bot_slab_t_mm) / 1000.0
    vol_outer_m3 = area_out * total_h_m           # объём "коробки" по наружному контуру
    uplift_force_kN = vol_outer_m3 * WATER_KG_M3 * G / 1000.0   # кН, вытесненный объём воды

    vol_concrete_m3 = area_walls_plan * (IN_H / 1000.0) + area_out * (TOP_SLAB_T / 1000.0) \
                       + area_out * (bot_slab_t_mm / 1000.0)
    weight_concrete_kN = vol_concrete_m3 * CONCRETE_KG_M3 * G / 1000.0

    vol_soil_m3 = area_out * (SOIL_OVER_TOP / 1000.0)
    weight_soil_kN = (vol_soil_m3 * 1800 * G / 1000.0) if include_soil_weight else 0.0  # плотность грунта ~1800 кг/м3, предв.

    resisting_kN = weight_concrete_kN + weight_soil_kN
    fs = resisting_kN / uplift_force_kN if uplift_force_kN else float("inf")
    return {
        "vol_outer_m3": round(vol_outer_m3, 3),
        "uplift_kN": round(uplift_force_kN, 1),
        "weight_concrete_kN": round(weight_concrete_kN, 1),
        "weight_soil_kN": round(weight_soil_kN, 1),
        "resisting_kN": round(resisting_kN, 1),
        "FS": round(fs, 2),
    }

BUOY_A_with_soil = buoyancy_check(BOT_SLAB_T, True)
BUOY_A_no_soil = buoyancy_check(BOT_SLAB_T, False)
BUOY_B_with_soil = buoyancy_check(BOT_SLAB_T_B, True)
BUOY_B_no_soil = buoyancy_check(BOT_SLAB_T_B, False)

# --------------------------------------------------------------------------
# 6. БОКОВОЕ ДАВЛЕНИЕ ГРУНТА (упрощённо, метод Ранкина, предварительно)
# --------------------------------------------------------------------------
def lateral_pressure(gamma, phi_deg, depth_m, water_from_m=None, gamma_w=10.0):
    phi = math.radians(phi_deg)
    Ka = (1 - math.sin(phi)) / (1 + math.sin(phi))
    p_soil = Ka * gamma * depth_m
    p_water = 0.0
    if water_from_m is not None and depth_m > water_from_m:
        p_water = gamma_w * (depth_m - water_from_m)
    return p_soil, p_water, p_soil + p_water

WALL_H_M = IN_H / 1000.0
scenarios_lateral = {
    "1. Сухой песок (γ=17 кН/м3, φ=32°)": dict(gamma=17, phi=32, water_from_m=None),
    "2. Влажный песок (γ=19 кН/м3, φ=28°)": dict(gamma=19, phi=28, water_from_m=None),
    "3. Насыщенный водой грунт (γ=20 кН/м3, φ=25°, УГВ=0)": dict(gamma=20, phi=25, water_from_m=0.0),
}
LATERAL_RESULTS = {}
for name, p in scenarios_lateral.items():
    p_top_soil, p_top_water, p_top = lateral_pressure(p["gamma"], p["phi"], 0.0, p["water_from_m"])
    p_bot_soil, p_bot_water, p_bot = lateral_pressure(p["gamma"], p["phi"], WALL_H_M, p["water_from_m"])
    LATERAL_RESULTS[name] = {
        "p_top_kPa": round(p_top, 2), "p_bot_kPa": round(p_bot, 2),
        "p_bot_soil_kPa": round(p_bot_soil, 2), "p_bot_water_kPa": round(p_bot_water, 2),
        "resultant_kN_m": round(0.5 * (p_top + p_bot) * WALL_H_M, 1),
    }

# --------------------------------------------------------------------------
# 7. ВЕНТИЛЯЦИЯ, ЭЛЕКТРИКА, ВОДА — справочные величины для смет/README
# --------------------------------------------------------------------------
PEOPLE = 4
AIR_FLOW_MIN_M3H = 60
AIR_FLOW_MAX_M3H = 100
WATER_MIN_L = 3 * PEOPLE * 3      # 36 л (3сут х 3л х 4чел)
WATER_PRACTICAL_L = 100
WATER_PREFERRED_L = (150, 200)

if __name__ == "__main__":
    print("OUT:", OUT_L, OUT_W, "TOTAL_DEPTH:", TOTAL_DEPTH)
    print("Concrete main box A (350mm):", round(vol_main_box_A, 3))
    print("Concrete main box B (400mm):", round(vol_main_box_B, 3))
    print("Concrete total order A:", round(vol_total_order_A, 3))
    print("CONCRETE_TABLE:", CONCRETE_TABLE)
    print("Wall D12 length/mass:", round(len_walls_d12_m,1), round(mass_walls_d12_kg,1))
    print("Top slab D14 length/mass:", round(len_top_slab_d14_m,1), round(mass_top_slab_d14_kg,1))
    print("Bot slab D14 length/mass:", round(len_bot_slab_d14_m,1), round(mass_bot_slab_d14_kg,1))
    print("REBAR_TABLE:", REBAR_TABLE)
    print("Total rebar mass (t):", round(mass_rebar_total_t, 3))
    print("Buoyancy A with soil:", BUOY_A_with_soil)
    print("Buoyancy A no soil:", BUOY_A_no_soil)
    print("Buoyancy B with soil:", BUOY_B_with_soil)
    print("Buoyancy B no soil:", BUOY_B_no_soil)
    print("Lateral:", LATERAL_RESULTS)
