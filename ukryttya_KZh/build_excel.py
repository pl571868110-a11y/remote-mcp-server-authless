# -*- coding: utf-8 -*-
"""
Формирование Excel-комплекта ukryttya_3x4_full_estimate_2026.xlsx
15 листов, суммы и итоги — через формулы Excel (не константы).
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from calc import (DISCLAIMER, PROJECT_NAME, PROJECT_LOCATION, PROJECT_DATE,
                   OUT_L, OUT_W, IN_L, IN_W, IN_H, WALL_T, TOP_SLAB_T, BOT_SLAB_T,
                   BOT_SLAB_T_B, SOIL_OVER_TOP, ENTRY_OPENING, HATCH, CONCRETE_CLASS,
                   CONCRETE_W, CONCRETE_F, REBAR_CLASS, REBAR_DENSITY, PEOPLE,
                   AIR_FLOW_MIN_M3H, AIR_FLOW_MAX_M3H, WATER_PREFERRED_L)
from pricing import BUDGET, RESERVE_RATE, BATTERY_10KWH, Q_CONCRETE_M3, Q_REBAR_T

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
XLSX_PATH = os.path.join(OUT_DIR, "ukryttya_3x4_full_estimate_2026.xlsx")

HDR_FILL = PatternFill("solid", fgColor="DBE5F1")
RED_FILL = PatternFill("solid", fgColor="FDEAEA")
BOLD = Font(bold=True)
RED_BOLD = Font(bold=True, color="C00000")
THIN = Side(style="thin", color="AAAAAA")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")

wb = Workbook()
wb.remove(wb.active)


def add_sheet(name):
    ws = wb.create_sheet(name)
    return ws


def style_header_row(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HDR_FILL
        cell.font = BOLD
        cell.border = BORDER


def disclaimer_block(ws, row, ncols=6):
    ws.merge_cells(start_row=row, start_column=1, end_row=row + 2, end_column=ncols)
    cell = ws.cell(row=row, column=1)
    cell.value = ("ЧЕРНОВОЙ ИНЖЕНЕРНЫЙ КОМПЛЕКТ. " + DISCLAIMER)
    cell.font = RED_BOLD
    cell.fill = RED_FILL
    cell.alignment = WRAP
    return row + 4


def autosize(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ============================================================================
# 1. ИСХОДНЫЕ ДАННЫЕ
# ============================================================================
ws = add_sheet("Исходные данные")
r = disclaimer_block(ws, 1, 4)
ws.cell(row=r, column=1, value="Объект").font = BOLD
ws.cell(row=r, column=2, value=PROJECT_NAME)
r += 1
ws.cell(row=r, column=1, value="Местоположение").font = BOLD
ws.cell(row=r, column=2, value=PROJECT_LOCATION)
r += 1
ws.cell(row=r, column=1, value="Дата").font = BOLD
ws.cell(row=r, column=2, value=PROJECT_DATE)
r += 2

params = [
    ("Внутренняя длина, мм", "IN_L", IN_L),
    ("Внутренняя ширина, мм", "IN_W", IN_W),
    ("Чистая высота, мм", "IN_H", IN_H),
    ("Толщина стен, мм", "WALL_T", WALL_T),
    ("Толщина верхней плиты, мм", "TOP_SLAB_T", TOP_SLAB_T),
    ("Толщина нижней плиты (сцен. A), мм", "BOT_SLAB_T", BOT_SLAB_T),
    ("Толщина нижней плиты (сцен. B, усил.), мм", "BOT_SLAB_T_B", BOT_SLAB_T_B),
    ("Грунт над верхней плитой, мм", "SOIL_OVER_TOP", SOIL_OVER_TOP),
    ("Проём входа, мм", "ENTRY_OPENING", ENTRY_OPENING),
    ("Аварийный люк, мм", "HATCH", f"{HATCH[0]}x{HATCH[1]}"),
    ("Количество людей", "PEOPLE", PEOPLE),
]
ws.cell(row=r, column=1, value="Параметр").font = BOLD
ws.cell(row=r, column=2, value="Код").font = BOLD
ws.cell(row=r, column=3, value="Значение").font = BOLD
style_header_row(ws, r, 3)
r += 1
PARAM_ROW = {}
for label, code, val in params:
    ws.cell(row=r, column=1, value=label)
    ws.cell(row=r, column=2, value=code)
    ws.cell(row=r, column=3, value=val)
    PARAM_ROW[code] = r
    r += 1

r += 1
ws.cell(row=r, column=1, value=f"Наружная длина (=IN_L+2*WALL_T), мм").font = BOLD
ws.cell(row=r, column=3, value=f"=C{PARAM_ROW['IN_L']}+2*C{PARAM_ROW['WALL_T']}")
OUT_L_ROW = r
r += 1
ws.cell(row=r, column=1, value=f"Наружная ширина (=IN_W+2*WALL_T), мм").font = BOLD
ws.cell(row=r, column=3, value=f"=C{PARAM_ROW['IN_W']}+2*C{PARAM_ROW['WALL_T']}")
OUT_W_ROW = r
r += 1
ws.cell(row=r, column=1, value="Общая глубина (=SOIL+TOP+IN_H+BOT_A), мм").font = BOLD
ws.cell(row=r, column=3,
        value=f"=C{PARAM_ROW['SOIL_OVER_TOP']}+C{PARAM_ROW['TOP_SLAB_T']}+C{PARAM_ROW['IN_H']}+C{PARAM_ROW['BOT_SLAB_T']}")
r += 2

ws.cell(row=r, column=1, value="Материалы (предварительно)").font = BOLD
r += 1
for line in [f"Бетон: {CONCRETE_CLASS} {CONCRETE_W} {CONCRETE_F}",
             f"Арматура: {REBAR_CLASS}",
             "Стены: Ø12/150 верт.+гориз., 2 сетки",
             "Плиты (верх/низ): Ø14/150х150, верх+низ сетки",
             "Усиление проёмов: Ø16 (предварительно)"]:
    ws.cell(row=r, column=1, value=line)
    r += 1

r += 1
ws.cell(row=r, column=1, value="ОТСУТСТВУЮЩИЕ ИСХОДНЫЕ ДАННЫЕ (обязательны до рабочего проекта)").font = RED_BOLD
r += 1
for line in ["Инженерно-геологические изыскания (литология, УГВ, физ-мех. св-ва грунтов)",
             "Уровень грунтовых вод (сезонный максимум)",
             "Плотность и угол внутреннего трения грунта обратной засыпки",
             "Расчётное сопротивление основания R0",
             "Фактическая отметка участка, геодезическая привязка",
             "Нагрузки сверху (проезд техники, снег, благоустройство)",
             "Требуемый класс защитного сооружения ЦЗ",
             "Паспортные данные выбранных дверей и люка"]:
    ws.cell(row=r, column=1, value="- " + line).font = Font(color="C00000")
    r += 1

autosize(ws, [46, 14, 40, 20])
ws.freeze_panes = "A2"

# сохраняем ссылки для других листов
REF_OUT_L = f"'Исходные данные'!C{OUT_L_ROW}"
REF_OUT_W = f"'Исходные данные'!C{OUT_W_ROW}"
REF_IN_L = f"'Исходные данные'!C{PARAM_ROW['IN_L']}"
REF_IN_W = f"'Исходные данные'!C{PARAM_ROW['IN_W']}"
REF_IN_H = f"'Исходные данные'!C{PARAM_ROW['IN_H']}"
REF_WALL_T = f"'Исходные данные'!C{PARAM_ROW['WALL_T']}"
REF_TOP_T = f"'Исходные данные'!C{PARAM_ROW['TOP_SLAB_T']}"
REF_BOT_T = f"'Исходные данные'!C{PARAM_ROW['BOT_SLAB_T']}"
REF_BOT_T_B = f"'Исходные данные'!C{PARAM_ROW['BOT_SLAB_T_B']}"
REF_SOIL = f"'Исходные данные'!C{PARAM_ROW['SOIL_OVER_TOP']}"
REF_PEOPLE = f"'Исходные данные'!C{PARAM_ROW['PEOPLE']}"

print("Sheet 1 done:", XLSX_PATH)

# ============================================================================
# 2. БЕТОН
# ============================================================================
ws = add_sheet("Бетон")
r = disclaimer_block(ws, 1, 6)
ws.cell(row=r, column=1, value=f"Класс бетона: {CONCRETE_CLASS} {CONCRETE_W} {CONCRETE_F} (предварительно)").font = BOLD
r += 2

ws.cell(row=r, column=1, value="Площадь наружная, м2").font = BOLD
ws.cell(row=r, column=3, value=f"=({REF_OUT_L}/1000)*({REF_OUT_W}/1000)")
AREA_OUT_CELL = f"Бетон!C{r}"
r += 1
ws.cell(row=r, column=1, value="Площадь внутренняя, м2").font = BOLD
ws.cell(row=r, column=3, value=f"=({REF_IN_L}/1000)*({REF_IN_W}/1000)")
AREA_IN_CELL = f"Бетон!C{r}"
r += 1
ws.cell(row=r, column=1, value="Площадь стен в плане, м2").font = BOLD
ws.cell(row=r, column=3, value=f"={AREA_OUT_CELL}-{AREA_IN_CELL}")
AREA_WALLS_CELL = f"Бетон!C{r}"
r += 2

hdr_row = r
headers = ["Элемент", "Толщина/высота, мм", "Формула объёма", "Объём, м3", "Класс бетона", "Примечание"]
for i, h in enumerate(headers, start=1):
    ws.cell(row=hdr_row, column=i, value=h)
style_header_row(ws, hdr_row, len(headers))
r += 1

vol_rows_start = r
rows = [
    ("Нижняя плита (сцен. A)", REF_BOT_T, f"={AREA_OUT_CELL}*(B{r}/1000)", "по сценарию A"),
    ("Нижняя плита (сцен. B, усил.)", REF_BOT_T_B, f"={AREA_OUT_CELL}*(B{r+1}/1000)", "по сценарию B"),
    ("Стены", REF_IN_H, f"={AREA_WALLS_CELL}*(B{r+2}/1000)", "чистая высота"),
    ("Верхняя плита", REF_TOP_T, f"={AREA_OUT_CELL}*(B{r+3}/1000)", ""),
]
for label, thickness_ref, _formula_placeholder, note in rows:
    area_label = "площ.стен" if label == "Стены" else "площ.наруж"
    area_cell = AREA_WALLS_CELL if label == "Стены" else AREA_OUT_CELL
    ws.cell(row=r, column=1, value=label)
    ws.cell(row=r, column=2, value=f"={thickness_ref}")
    ws.cell(row=r, column=3, value=f"{area_label} x B{r}/1000")
    ws.cell(row=r, column=4, value=f"={area_cell}*(B{r}/1000)")
    ws.cell(row=r, column=5, value=f"{CONCRETE_CLASS} {CONCRETE_W} {CONCRETE_F}")
    ws.cell(row=r, column=6, value=note)
    r += 1

extra = [
    ("Входная шахта (предв.)", 1.80),
    ("Аварийная шахта (предв.)", 0.90),
    ("Технологический резерв", 0.85),
]
for label, val in extra:
    ws.cell(row=r, column=1, value=label)
    ws.cell(row=r, column=4, value=val)
    ws.cell(row=r, column=5, value=f"{CONCRETE_CLASS} {CONCRETE_W} {CONCRETE_F}")
    ws.cell(row=r, column=6, value="предварительно, укрупнённо")
    r += 1

total_row = r
ws.cell(row=r, column=1, value="ИТОГО (заказ, сценарий A нижней плиты)").font = BOLD
ws.cell(row=r, column=4, value=f"=D{vol_rows_start}+D{vol_rows_start+2}+D{vol_rows_start+3}+SUM(D{vol_rows_start+4}:D{r-1})")
ws.cell(row=r, column=4).font = BOLD
CONCRETE_TOTAL_CELL = f"Бетон!D{total_row}"
r += 2

ws.cell(row=r, column=1, value="Примечание: объёмы — предварительные (укрупнённая методика). Наружная гидроизоляция")
r += 1
ws.cell(row=r, column=1, value="невозможна -> рассматривать как 'белую ванну' (см. README).")

for row_i in range(hdr_row, total_row + 1):
    for col_i in range(1, 7):
        ws.cell(row=row_i, column=col_i).border = BORDER

autosize(ws, [34, 18, 14, 12, 22, 30])
ws.freeze_panes = "A2"
print("Sheet 2 done")

# ============================================================================
# 3. АРМАТУРА
# ============================================================================
ws = add_sheet("Арматура")
r = disclaimer_block(ws, 1, 8)
r += 1
ws.cell(row=r, column=1, value="Класс арматуры").font = BOLD
ws.cell(row=r, column=2, value=REBAR_CLASS)
r += 1
ws.cell(row=r, column=1, value="Шаг основной арматуры, мм").font = BOLD
ws.cell(row=r, column=2, value=150)
STEP_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Линейная масса Ø12, кг/м").font = BOLD
ws.cell(row=r, column=2, value=REBAR_DENSITY[12])
D12_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Линейная масса Ø14, кг/м").font = BOLD
ws.cell(row=r, column=2, value=REBAR_DENSITY[14])
D14_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Линейная масса Ø16, кг/м").font = BOLD
ws.cell(row=r, column=2, value=REBAR_DENSITY[16])
D16_CELL = f"Арматура!B{r}"
r += 2

ws.cell(row=r, column=1, value="Периметр стен по осям, м").font = BOLD
ws.cell(row=r, column=2, value=f"=2*(({REF_OUT_L}-{REF_WALL_T})+({REF_OUT_W}-{REF_WALL_T}))/1000")
PERIM_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Длина верт. стержня (высота+2х300 анкеровка), м").font = BOLD
ws.cell(row=r, column=2, value=f"=({REF_IN_H}+600)/1000")
VBAR_LEN_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Число верт. стержней на 1 сетку").font = BOLD
ws.cell(row=r, column=2, value=f"=ROUND({PERIM_CELL}*1000/{STEP_CELL},0)+1")
N_VERT_1_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Число гориз. стержней на 1 сетку (по высоте)").font = BOLD
ws.cell(row=r, column=2, value=f"=ROUND({REF_IN_H}/{STEP_CELL},0)+1")
N_HORIZ_1_CELL = f"Арматура!B{r}"
r += 1
ws.cell(row=r, column=1, value="Длина 1 гориз. стержня (периметр+нахлёст 0.3м), м").font = BOLD
ws.cell(row=r, column=2, value=f"={PERIM_CELL}+0.3")
HBAR_LEN_CELL = f"Арматура!B{r}"
r += 2

hdr_row = r
headers = ["Поз.", "Ø, мм", "Назначение", "Кол-во стержней", "Длина стержня, м", "Общая длина, м", "Масса, кг"]
for i, h in enumerate(headers, start=1):
    ws.cell(row=hdr_row, column=i, value=h)
style_header_row(ws, hdr_row, len(headers))
r += 1

data_start = r
# 1: verticals (2 layers)
ws.cell(row=r, column=1, value=1); ws.cell(row=r, column=2, value=12)
ws.cell(row=r, column=3, value="Стены верт. (2 сетки)")
ws.cell(row=r, column=4, value=f"=2*{N_VERT_1_CELL}")
ws.cell(row=r, column=5, value=f"={VBAR_LEN_CELL}")
ws.cell(row=r, column=6, value=f"=D{r}*E{r}")
ws.cell(row=r, column=7, value=f"=F{r}*{D12_CELL}")
row_vert = r; r += 1
# 2: horizontals (2 layers)
ws.cell(row=r, column=1, value=2); ws.cell(row=r, column=2, value=12)
ws.cell(row=r, column=3, value="Стены гориз. (2 сетки)")
ws.cell(row=r, column=4, value=f"=2*{N_HORIZ_1_CELL}")
ws.cell(row=r, column=5, value=f"={HBAR_LEN_CELL}")
ws.cell(row=r, column=6, value=f"=D{r}*E{r}")
ws.cell(row=r, column=7, value=f"=F{r}*{D12_CELL}")
row_horiz = r; r += 1
# 3: corner extras ~8% of (vert+horiz mass)
ws.cell(row=r, column=1, value=3); ws.cell(row=r, column=2, value=12)
ws.cell(row=r, column=3, value="Угловые/доборные эл-ты стен (~8%, предв.)")
ws.cell(row=r, column=7, value=f"=0.08*(G{row_vert}+G{row_horiz})")
row_corner = r; r += 1
# 4: top slab mesh (2 layers top+bottom)
n_top_a = f"(ROUND({REF_OUT_W}/{STEP_CELL},0)+1)"
n_top_b = f"(ROUND({REF_OUT_L}/{STEP_CELL},0)+1)"
ws.cell(row=r, column=1, value=4); ws.cell(row=r, column=2, value=14)
ws.cell(row=r, column=3, value="Верхняя плита, сетка верх+низ")
ws.cell(row=r, column=4, value=f"=2*({n_top_a}+{n_top_b})")
ws.cell(row=r, column=6, value=f"=2*({n_top_a}*{REF_OUT_L}/1000+{n_top_b}*{REF_OUT_W}/1000)")
ws.cell(row=r, column=7, value=f"=F{r}*{D14_CELL}")
row_top = r; r += 1
# 5: bottom slab mesh
ws.cell(row=r, column=1, value=5); ws.cell(row=r, column=2, value=14)
ws.cell(row=r, column=3, value="Нижняя плита, сетка верх+низ")
ws.cell(row=r, column=4, value=f"=2*({n_top_a}+{n_top_b})")
ws.cell(row=r, column=6, value=f"=2*({n_top_a}*{REF_OUT_L}/1000+{n_top_b}*{REF_OUT_W}/1000)")
ws.cell(row=r, column=7, value=f"=F{r}*{D14_CELL}")
row_bot = r; r += 1
# 6/7: openings reinforcement
ws.cell(row=r, column=1, value=6); ws.cell(row=r, column=2, value=16)
ws.cell(row=r, column=3, value="Усиление проёма входа (4х1.5м, предв.)")
ws.cell(row=r, column=4, value=4); ws.cell(row=r, column=5, value=1.5)
ws.cell(row=r, column=6, value=f"=D{r}*E{r}")
ws.cell(row=r, column=7, value=f"=F{r}*{D16_CELL}")
row_op1 = r; r += 1
ws.cell(row=r, column=1, value=7); ws.cell(row=r, column=2, value=16)
ws.cell(row=r, column=3, value="Усиление проёма авар. люка (4х1.5м, предв.)")
ws.cell(row=r, column=4, value=4); ws.cell(row=r, column=5, value=1.5)
ws.cell(row=r, column=6, value=f"=D{r}*E{r}")
ws.cell(row=r, column=7, value=f"=F{r}*{D16_CELL}")
row_op2 = r; r += 1
# 8: montaж 3%
ws.cell(row=r, column=1, value=8); ws.cell(row=r, column=3, value="Монтажная арматура (фиксаторы, ~3%)")
ws.cell(row=r, column=7, value=f"=0.03*(G{row_vert}+G{row_horiz}+G{row_top}+G{row_bot})")
row_install = r; r += 1
# 9: reserve 5%
ws.cell(row=r, column=1, value=9); ws.cell(row=r, column=3, value="Технологический запас (~5%)")
ws.cell(row=r, column=7, value=f"=0.05*(G{row_vert}+G{row_horiz}+G{row_top}+G{row_bot}+G{row_op1}+G{row_op2}+G{row_corner}+G{row_install})")
row_reserve = r; r += 1

total_row = r
ws.cell(row=r, column=3, value="ВСЕГО, кг").font = BOLD
ws.cell(row=r, column=7, value=f"=SUM(G{data_start}:G{row_reserve})")
ws.cell(row=r, column=7).font = BOLD
r += 1
ws.cell(row=r, column=3, value="ВСЕГО, т").font = BOLD
ws.cell(row=r, column=7, value=f"=G{total_row}/1000")
REBAR_TOTAL_T_CELL = f"Арматура!G{r}"
r += 2

for row_i in range(hdr_row, total_row + 1):
    for col_i in range(1, 8):
        ws.cell(row=row_i, column=col_i).border = BORDER

ws.cell(row=r, column=1, value=f"Ориентир ТЗ: ~2,4 т — сверить после разработки рабочих чертежей.")
autosize(ws, [6, 8, 40, 16, 16, 16, 14])
ws.freeze_panes = "A2"
print("Sheet 3 done")

# ============================================================================
# 4. ЗЕМЛЯНЫЕ РАБОТЫ
# ============================================================================
ws = add_sheet("Земляные работы")
r = disclaimer_block(ws, 1, 5)
r += 1
ws.cell(row=r, column=1, value="Отступ котлована от короба на сторону, м").font = BOLD
ws.cell(row=r, column=2, value=1.0)
MARGIN_CELL = f"'Земляные работы'!B{r}"
r += 1
ws.cell(row=r, column=1, value="Запас по глубине (рабочее пространство), м").font = BOLD
ws.cell(row=r, column=2, value=0.3)
DEPTH_MARGIN_CELL = f"'Земляные работы'!B{r}"
r += 2

ws.cell(row=r, column=1, value="Длина котлована, м").font = BOLD
ws.cell(row=r, column=2, value=f"=({REF_OUT_L}/1000)+2*{MARGIN_CELL}")
PIT_L_CELL = f"'Земляные работы'!B{r}"
r += 1
ws.cell(row=r, column=1, value="Ширина котлована, м").font = BOLD
ws.cell(row=r, column=2, value=f"=({REF_OUT_W}/1000)+2*{MARGIN_CELL}")
PIT_W_CELL = f"'Земляные работы'!B{r}"
r += 1
ws.cell(row=r, column=1, value="Глубина котлована, м").font = BOLD
ws.cell(row=r, column=2, value=f"=({REF_SOIL}+{REF_TOP_T}+{REF_IN_H}+{REF_BOT_T})/1000+{DEPTH_MARGIN_CELL}")
PIT_D_CELL = f"'Земляные работы'!B{r}"
r += 1
ws.cell(row=r, column=1, value="Объём котлована, м3").font = BOLD
ws.cell(row=r, column=2, value=f"={PIT_L_CELL}*{PIT_W_CELL}*{PIT_D_CELL}")
PIT_VOL_CELL = f"'Земляные работы'!B{r}"
r += 1
ws.cell(row=r, column=1, value="Объём обратной засыпки (~40% от котлована), м3").font = BOLD
ws.cell(row=r, column=2, value=f"=0.4*{PIT_VOL_CELL}")
BACKFILL_CELL = f"'Земляные работы'!B{r}"
r += 1
ws.cell(row=r, column=1, value="Вывоз излишков грунта, м3").font = BOLD
ws.cell(row=r, column=2, value=f"={PIT_VOL_CELL}-{BACKFILL_CELL}")
r += 2

hdr_row = r
for i, h in enumerate(["Статья", "LOW, грн", "REALISTIC, грн", "HIGH, грн"], start=1):
    ws.cell(row=hdr_row, column=i, value=h)
style_header_row(ws, hdr_row, 4)
r += 1
low, real, high, note = BUDGET["A"]
ws.cell(row=r, column=1, value=note)
ws.cell(row=r, column=2, value=low)
ws.cell(row=r, column=3, value=real)
ws.cell(row=r, column=4, value=high)
data_row = r
r += 1
ws.cell(row=r, column=1, value="ПОДЫТОГ (A)").font = BOLD
for col in (2, 3, 4):
    ws.cell(row=r, column=col, value=f"=SUM({get_column_letter(col)}{data_row}:{get_column_letter(col)}{data_row})").font = BOLD
EARTHWORK_TOTAL_ROW = r
autosize(ws, [46, 16, 16, 16])
ws.freeze_panes = "A2"
print("Sheet 4 done")

# ============================================================================
# Generic "items" sheet builder (used for 5,7,9(sanitation-like),10,11)
# ============================================================================
def build_items_sheet(name, items, ncols_disc=5):
    """items: list of (описание, ед, кол-во, LOW_price, REAL_price, HIGH_price, примечание)"""
    ws = add_sheet(name)
    r = disclaimer_block(ws, 1, ncols_disc)
    r += 1
    hdr = r
    headers = ["Наименование", "Ед.", "Кол-во", "LOW цена/ед", "REALISTIC цена/ед", "HIGH цена/ед",
               "LOW сумма", "REALISTIC сумма", "HIGH сумма", "Примечание"]
    for i, h in enumerate(headers, start=1):
        ws.cell(row=hdr, column=i, value=h)
    style_header_row(ws, hdr, len(headers))
    r += 1
    start = r
    for desc, unit, qty, lo, re_, hi, note in items:
        ws.cell(row=r, column=1, value=desc)
        ws.cell(row=r, column=2, value=unit)
        ws.cell(row=r, column=3, value=qty)
        ws.cell(row=r, column=4, value=lo)
        ws.cell(row=r, column=5, value=re_)
        ws.cell(row=r, column=6, value=hi)
        ws.cell(row=r, column=7, value=f"=C{r}*D{r}")
        ws.cell(row=r, column=8, value=f"=C{r}*E{r}")
        ws.cell(row=r, column=9, value=f"=C{r}*F{r}")
        ws.cell(row=r, column=10, value=note)
        r += 1
    end = r - 1
    ws.cell(row=r, column=1, value="ИТОГО").font = BOLD
    for col in (7, 8, 9):
        letter = get_column_letter(col)
        ws.cell(row=r, column=col, value=f"=SUM({letter}{start}:{letter}{end})").font = BOLD
    total_row = r
    for row_i in range(hdr, r + 1):
        for col_i in range(1, 11):
            ws.cell(row=row_i, column=col_i).border = BORDER
    autosize(ws, [40, 8, 8, 12, 14, 12, 12, 14, 12, 30])
    ws.freeze_panes = "A2"
    return ws, start, total_row


# ============================================================================
# 5. ДВЕРИ И ЛЮКИ
# ============================================================================
ws5, s5, t5 = build_items_sheet("Двери и люки", [
    ("Наружная защитно-герметичная дверь (проём 900мм)", "шт", 1, 40000, 60000, 90000,
     "тип и посадочные размеры уточнить по паспорту изделия"),
    ("Внутренняя герметичная дверь", "шт", 1, 15000, 28000, 45000, "тип уточнить по паспорту изделия"),
    ("Металлическая рамка + крышка люка 800х800", "компл", 1, 7000, 12000, 18000, "тип уточнить по паспорту"),
    ("Закладные детали и герметизация проёмов", "компл", 1, 3000, 5000, 7000, ""),
])

# ============================================================================
# 6. ВЕНТИЛЯЦИЯ
# ============================================================================
ws = add_sheet("Вентиляция")
r = disclaimer_block(ws, 1, 6)
r += 1
ws.cell(row=r, column=1, value=f"Количество людей").font = BOLD
ws.cell(row=r, column=2, value=f"={REF_PEOPLE}")
r += 1
ws.cell(row=r, column=1, value="Норма воздухообмена на 1 чел., м3/ч (мин-макс)").font = BOLD
ws.cell(row=r, column=2, value=AIR_FLOW_MIN_M3H / PEOPLE)
ws.cell(row=r, column=3, value=AIR_FLOW_MAX_M3H / PEOPLE)
r += 1
ws.cell(row=r, column=1, value="Требуемый воздухообмен, м3/ч (мин-макс)").font = BOLD
ws.cell(row=r, column=2, value=f"=B{r-1}*B{r-2}")
ws.cell(row=r, column=3, value=f"=C{r-1}*B{r-2}")
r += 2

hdr = r
for i, h in enumerate(["Вариант", "Оборудование", "Мощность", "LOW, грн", "REALISTIC, грн", "HIGH, грн", "Плюсы", "Минусы"], start=1):
    ws.cell(row=hdr, column=i, value=h)
style_header_row(ws, hdr, 8)
r += 1
vent_rows = [
    ("A. Базовая принудительная", "приточно-вытяжные вентиляторы, обратные клапаны, фильтр G4, ручной резерв",
     "~60-100 м3/ч, ~40-80 Вт", *BUDGET["L"][0:2], BUDGET["L"][1], "просто, недорого", "нет защиты от ОВ/пыли/дыма"),
    ("B. Специализир. ФВУ", "фильтровентиляционная установка, противовзрывные клапаны, фильтр аэрозоль+сорбция",
     "~100-150 м3/ч, ~80-150 Вт", BUDGET["L"][1], BUDGET["L"][1], BUDGET["L"][2], "выше защита воздуха", "дороже, сложнее"),
]
vent_start = r
for variant, equip, power, lo, mid, hi, pros, cons in vent_rows:
    ws.cell(row=r, column=1, value=variant)
    ws.cell(row=r, column=2, value=equip)
    ws.cell(row=r, column=3, value=power)
    ws.cell(row=r, column=4, value=lo)
    ws.cell(row=r, column=5, value=mid)
    ws.cell(row=r, column=6, value=hi)
    ws.cell(row=r, column=7, value=pros)
    ws.cell(row=r, column=8, value=cons)
    r += 1
r += 1
ws.cell(row=r, column=1, value="Обязательно во всех вариантах: датчик CO2, датчик CO, дымовой датчик, ручной резервный привод.")
for row_i in range(hdr, vent_start + len(vent_rows)):
    for col_i in range(1, 9):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [22, 42, 18, 12, 14, 12, 22, 22])
ws.freeze_panes = "A2"
print("Sheets 5,6 done")

# ============================================================================
# 7. ЭЛЕКТРИКА
# ============================================================================
ws7, s7, t7 = build_items_sheet("Электрика", [
    ("Ввод 230В, вводной автомат, УЗО", "компл", 1, 8000, 12000, 18000, ""),
    ("Электрощит в сборе (автоматы, УЗО линий)", "компл", 1, 7000, 12000, 20000, ""),
    ("Кабельная разводка (силовая+освещение)", "компл", 1, 10000, 18000, 27000, ""),
    ("LED освещение (основное)", "компл", 1, 4000, 7000, 12000, ""),
    ("Аварийное освещение (авт. включение)", "компл", 1, 3000, 6000, 10000, ""),
    ("Розетки + USB-C блоки", "компл", 1, 3000, 5000, 8000, ""),
])

# ============================================================================
# 8. АККУМУЛЯТОР
# ============================================================================
ws = add_sheet("Аккумулятор")
r = disclaimer_block(ws, 1, 5)
r += 1
ws.cell(row=r, column=1, value="Инвертор, кВт").font = BOLD
ws.cell(row=r, column=2, value=5)
r += 1
ws.cell(row=r, column=1, value="АКБ базовый вариант, кВт*ч").font = BOLD
ws.cell(row=r, column=2, value=5)
CAP5_CELL = f"Аккумулятор!B{r}"
r += 1
ws.cell(row=r, column=1, value="АКБ расширенный вариант, кВт*ч").font = BOLD
ws.cell(row=r, column=2, value=10)
CAP10_CELL = f"Аккумулятор!B{r}"
r += 2

hdr = r
for i, h in enumerate(["Потребитель", "Мощность, Вт", f"Автономность {CAP5_CELL.split('!')[1]}... 5кВт*ч, ч",
                        "Автономность 10кВт*ч, ч"], start=1):
    ws.cell(row=hdr, column=i, value=h)
ws.cell(row=hdr, column=3, value="Автономность 5 кВт*ч, ч")
ws.cell(row=hdr, column=4, value="Автономность 10 кВт*ч, ч")
style_header_row(ws, hdr, 4)
r += 1
loads = [("Вентиляция (вариант A)", 60), ("Освещение LED", 40), ("Телефоны (заряд, 4 шт.)", 20),
         ("Радиостанция", 15), ("Небольшой насос (циклично, ср.)", 80)]
load_start = r
for name, watt in loads:
    ws.cell(row=r, column=1, value=name)
    ws.cell(row=r, column=2, value=watt)
    ws.cell(row=r, column=3, value=f"={CAP5_CELL}*1000/B{r}")
    ws.cell(row=r, column=4, value=f"={CAP10_CELL}*1000/B{r}")
    r += 1
for row_i in range(hdr, r):
    for col_i in range(1, 5):
        ws.cell(row=row_i, column=col_i).border = BORDER
r += 1
ws.cell(row=r, column=1, value="Примечание: автономность указана отдельно по каждому потребителю (не суммарно).")
r += 2

hdr2 = r
for i, h in enumerate(["Позиция", "LOW, грн", "REALISTIC, грн", "HIGH, грн"], start=1):
    ws.cell(row=hdr2, column=i, value=h)
style_header_row(ws, hdr2, 4)
r += 1
ws.cell(row=r, column=1, value="Гибридный инвертор 5 кВт")
for col, val in zip((2, 3, 4), BUDGET["N"][:3]):
    ws.cell(row=r, column=col, value=val)
INV_ROW = r; r += 1
ws.cell(row=r, column=1, value="АКБ 5 кВт*ч (базовый)")
for col, val in zip((2, 3, 4), BUDGET["O"][:3]):
    ws.cell(row=r, column=col, value=val)
AKB5_ROW = r; r += 1
ws.cell(row=r, column=1, value="АКБ 10 кВт*ч (расширенный, отдельный расчёт)")
for col, val in zip((2, 3, 4), BATTERY_10KWH):
    ws.cell(row=r, column=col, value=val)
AKB10_ROW = r; r += 1
for row_i in range(hdr2, r):
    for col_i in range(1, 5):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [40, 16, 22, 22])
ws.freeze_panes = "A2"
print("Sheets 7,8 done")

# ============================================================================
# 9. ВОДА
# ============================================================================
ws = add_sheet("Вода")
r = disclaimer_block(ws, 1, 5)
r += 1
ws.cell(row=r, column=1, value="Норма питья, л/чел/сутки").font = BOLD
ws.cell(row=r, column=2, value=3)
NORM_CELL = f"Вода!B{r}"
r += 1
ws.cell(row=r, column=1, value="Дней автономности").font = BOLD
ws.cell(row=r, column=2, value=3)
DAYS_CELL = f"Вода!B{r}"
r += 1
ws.cell(row=r, column=1, value="Минимальный запас, л (=норма x чел x дней)").font = BOLD
ws.cell(row=r, column=2, value=f"={NORM_CELL}*{REF_PEOPLE}*{DAYS_CELL}")
r += 1
ws.cell(row=r, column=1, value="Практический запас, л").font = BOLD
ws.cell(row=r, column=2, value=100)
r += 1
ws.cell(row=r, column=1, value="Предпочтительный запас, л (диапазон)").font = BOLD
ws.cell(row=r, column=2, value=WATER_PREFERRED_L[0])
ws.cell(row=r, column=3, value=WATER_PREFERRED_L[1])
r += 2

hdr = r
headers = ["Наименование", "Ед.", "Кол-во", "LOW цена/ед", "REALISTIC цена/ед", "HIGH цена/ед",
           "LOW сумма", "REALISTIC сумма", "HIGH сумма", "Примечание"]
for i, h in enumerate(headers, start=1):
    ws.cell(row=hdr, column=i, value=h)
style_header_row(ws, hdr, len(headers))
r += 1
water_items = [
    ("Пищевая ёмкость 150-200л + кран", "компл", 1, 3000, 5000, 9000, ""),
    ("Небольшой насос", "шт", 1, 2000, 4000, 7000, ""),
    ("Канистры питьевой воды (НЗ)", "компл", 1, 1500, 3000, 5000, ""),
    ("Ручной резерв (помпа/самотёк)", "компл", 1, 1500, 3000, 5000, ""),
]
start9 = r
for desc, unit, qty, lo, re_, hi, note in water_items:
    ws.cell(row=r, column=1, value=desc)
    ws.cell(row=r, column=2, value=unit)
    ws.cell(row=r, column=3, value=qty)
    ws.cell(row=r, column=4, value=lo)
    ws.cell(row=r, column=5, value=re_)
    ws.cell(row=r, column=6, value=hi)
    ws.cell(row=r, column=7, value=f"=C{r}*D{r}")
    ws.cell(row=r, column=8, value=f"=C{r}*E{r}")
    ws.cell(row=r, column=9, value=f"=C{r}*F{r}")
    ws.cell(row=r, column=10, value=note)
    r += 1
end9 = r - 1
ws.cell(row=r, column=1, value="ИТОГО").font = BOLD
for col in (7, 8, 9):
    letter = get_column_letter(col)
    ws.cell(row=r, column=col, value=f"=SUM({letter}{start9}:{letter}{end9})").font = BOLD
t9 = r
for row_i in range(hdr, r + 1):
    for col_i in range(1, 11):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [40, 8, 8, 12, 14, 12, 12, 14, 12, 20])
ws.freeze_panes = "A2"
print("Sheet 9 done")

# ============================================================================
# 10. САНИТАРИЯ
# ============================================================================
ws10, s10, t10 = build_items_sheet("Санитария", [
    ("Кассетный/химический биотуалет", "шт", 1, 3000, 6000, 10000, ""),
    ("Санитарная перегородка", "компл", 1, 1000, 2000, 4000, ""),
    ("Запас реагента", "компл", 1, 500, 1000, 1500, ""),
    ("Пакеты для биотуалета (запас)", "компл", 1, 300, 500, 1000, ""),
    ("Дезинфицирующие средства", "компл", 1, 200, 500, 1500, ""),
])

# ============================================================================
# 11. ОСНАЩЕНИЕ
# ============================================================================
ws11, s11, t11 = build_items_sheet("Оснащение", [
    ("2х-ярусная металлическая кровать", "шт", 2, 6000, 10000, 17000, "альт.: 4 складные койки"),
    ("Стол / место отдыха", "шт", 1, 2000, 4000, 7000, ""),
    ("Металлические стеллажи", "шт", 2, 2000, 3500, 6000, ""),
    ("Аптечка", "компл", 1, 1500, 3000, 6000, ""),
    ("Огнетушители", "шт", 2, 1000, 1500, 2500, ""),
    ("Инструменты (набор)", "компл", 1, 3000, 6000, 10000, ""),
    ("Средства связи (радиостанция)", "шт", 1, 2000, 4000, 8000, ""),
    ("Датчик CO2", "шт", 1, 2000, 4000, 7000, ""),
    ("Датчик CO", "шт", 1, 1500, 3000, 6000, ""),
    ("Дымовой датчик", "шт", 1, 500, 1000, 2000, ""),
])

# ============================================================================
# 12. СМЕТА (master)
# ============================================================================
ws = add_sheet("Смета")
r = disclaimer_block(ws, 1, 5)
r += 1
hdr = r
for i, h in enumerate(["№", "Раздел", "LOW, грн", "REALISTIC, грн", "HIGH, грн", "Источник"], start=1):
    ws.cell(row=hdr, column=i, value=h)
style_header_row(ws, hdr, 6)
r += 1
start_row = r

ws.cell(row=r, column=1, value="A"); ws.cell(row=r, column=2, value="Земляные работы")
ws.cell(row=r, column=3, value=f"='Земляные работы'!B{EARTHWORK_TOTAL_ROW}")
ws.cell(row=r, column=4, value=f"='Земляные работы'!C{EARTHWORK_TOTAL_ROW}")
ws.cell(row=r, column=5, value=f"='Земляные работы'!D{EARTHWORK_TOTAL_ROW}")
ws.cell(row=r, column=6, value="Котлован, вывоз/засыпка грунта")
r += 1
# Бетон и Арматура — цена за единицу задаётся здесь, количество берём с соответствующих листов
ws.cell(row=r, column=1, value="B"); ws.cell(row=r, column=2, value="Бетон")
ws.cell(row=r, column=3, value=f"=Бетон!{CONCRETE_TOTAL_CELL.split('!')[1]}*4500")
ws.cell(row=r, column=4, value=f"=Бетон!{CONCRETE_TOTAL_CELL.split('!')[1]}*6000")
ws.cell(row=r, column=5, value=f"=Бетон!{CONCRETE_TOTAL_CELL.split('!')[1]}*8000")
ws.cell(row=r, column=6, value="объём х цена/м3 (LOW 4500 / REAL 6000 / HIGH 8000 грн/м3)")
r += 1
ws.cell(row=r, column=1, value="C"); ws.cell(row=r, column=2, value="Арматура (материал)")
ws.cell(row=r, column=3, value=f"={REBAR_TOTAL_T_CELL}*33000")
ws.cell(row=r, column=4, value=f"={REBAR_TOTAL_T_CELL}*40000")
ws.cell(row=r, column=5, value=f"={REBAR_TOTAL_T_CELL}*55000")
ws.cell(row=r, column=6, value="масса х цена/т (LOW 33000 / REAL 40000 / HIGH 55000 грн/т)")
r += 1

lump_keys = ["D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X"]
names = {
    "D": "Опалубка", "E": "Арматурные работы", "F": "Бетонирование", "G": "Насос бетона", "H": "Доставка",
    "I": "Герметизация швов", "J": "Защитные двери", "K": "Аварийный люк", "L": "Вентиляция",
    "M": "Электрика", "N": "Инвертор", "O": "Аккумулятор", "P": "Вода", "Q": "Туалет",
    "R": "Спальные места", "S": "Мебель/хранение", "T": "Датчики", "U": "Инструменты",
    "V": "Геология", "W": "Проект КЖ", "X": "Технадзор",
}
sheet_ref = {
    "J": ("Двери и люки", t5), "L": ("Вентиляция", None), "M": ("Электрика", t7),
    "N": ("Аккумулятор", INV_ROW), "O": ("Аккумулятор", AKB5_ROW), "P": ("Вода", t9),
    "Q": ("Санитария", t10), "R": ("Оснащение", None), "S": ("Оснащение", None), "T": ("Оснащение", None),
}
for key in lump_keys:
    low, real, high, note = BUDGET[key]
    ws.cell(row=r, column=1, value=key)
    ws.cell(row=r, column=2, value=names[key])
    if key in ("J", "M", "Q"):
        sheet_name, trow = sheet_ref[key]
        ws.cell(row=r, column=3, value=f"='{sheet_name}'!G{trow}")
        ws.cell(row=r, column=4, value=f"='{sheet_name}'!H{trow}")
        ws.cell(row=r, column=5, value=f"='{sheet_name}'!I{trow}")
    elif key in ("N",):
        ws.cell(row=r, column=3, value=f"=Аккумулятор!B{INV_ROW}")
        ws.cell(row=r, column=4, value=f"=Аккумулятор!C{INV_ROW}")
        ws.cell(row=r, column=5, value=f"=Аккумулятор!D{INV_ROW}")
    elif key in ("O",):
        ws.cell(row=r, column=3, value=f"=Аккумулятор!B{AKB5_ROW}")
        ws.cell(row=r, column=4, value=f"=Аккумулятор!C{AKB5_ROW}")
        ws.cell(row=r, column=5, value=f"=Аккумулятор!D{AKB5_ROW}")
    elif key == "P":
        ws.cell(row=r, column=3, value=f"=Вода!G{t9}")
        ws.cell(row=r, column=4, value=f"=Вода!H{t9}")
        ws.cell(row=r, column=5, value=f"=Вода!I{t9}")
    else:
        ws.cell(row=r, column=3, value=low)
        ws.cell(row=r, column=4, value=real)
        ws.cell(row=r, column=5, value=high)
    ws.cell(row=r, column=6, value=note[:80])
    r += 1

end_row = r - 1
subtotal_row = r
ws.cell(row=r, column=2, value="ПОДЫТОГ (A-X)").font = BOLD
for col in (3, 4, 5):
    letter = get_column_letter(col)
    ws.cell(row=r, column=col, value=f"=SUM({letter}{start_row}:{letter}{end_row})").font = BOLD
r += 1
ws.cell(row=r, column=1, value="Y"); ws.cell(row=r, column=2, value="Резерв на непредвиденное (15%)").font = BOLD
for col in (3, 4, 5):
    letter = get_column_letter(col)
    ws.cell(row=r, column=col, value=f"={letter}{subtotal_row}*{RESERVE_RATE}").font = BOLD
reserve_row = r
r += 1
total_row = r
ws.cell(row=r, column=2, value="ИТОГО").font = BOLD
for col in (3, 4, 5):
    letter = get_column_letter(col)
    ws.cell(row=r, column=col, value=f"={letter}{subtotal_row}+{letter}{reserve_row}").font = BOLD

for row_i in range(hdr, total_row + 1):
    for col_i in range(1, 7):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [4, 26, 16, 16, 16, 46])
ws.freeze_panes = "A2"
print("Sheets 10,11,12 done")

# ============================================================================
# 13. ИСТОЧНИКИ ЦЕН
# ============================================================================
ws = add_sheet("Источники цен")
r = disclaimer_block(ws, 1, 4)
r += 1
ws.cell(row=r, column=1, value="Позиция").font = BOLD
ws.cell(row=r, column=2, value="Статус").font = BOLD
ws.cell(row=r, column=3, value="Источник / обоснование").font = BOLD
style_header_row(ws, r, 3)
r += 1
sources = [
    ("Бетон C35/45 W12F200, грн/м3", "сверено веб-поиском (базовый ориентир) + экспертная оценка класса/добавок",
     "ukrbeton.com, transbetonstroy.com.ua (сентябрь 2026) — базовая цена от ~3051 грн/м3; для W12/F200 и доставки принят диапазон 4500-8000 грн/м3"),
    ("Арматура А500С Ø12, грн/м (-> грн/т)", "сверено веб-поиском",
     "bekas.com.ua: 33.53 грн/м за Ø12 А500С (сентябрь 2026) => ~37 800 грн/т; для др. диаметров и с учётом волатильности принят диапазон 33000-55000 грн/т"),
    ("Защитно-герметичные двери", "сверено веб-поиском (аналоги военного/двойного назначения)",
     "antifire.ua: модели 52000-70000 грн за дверь ДУ-III/ДУ-I; для частного укрытия принят более широкий диапазон 45000-100000 грн"),
    ("Гибридный инвертор 5кВт / АКБ LiFePO4", "ориентировочно, конкретные цены в результатах поиска не найдены",
     "Оценка по общедоступным рыночным моделям (prom.ua, deps.ua, svoya-energy.com.ua), сентябрь 2026 — рекомендуется получить актуальные КП"),
    ("Земляные работы, опалубка, бетонирование, вентиляция (оборудование), электрика, мебель, сантехника",
     "экспертная оценка по аналогам", "Не проверялось прямым веб-поиском в рамках этого комплекта — требует коммерческих предложений подрядчиков"),
]
start = r
for pos, status, src in sources:
    ws.cell(row=r, column=1, value=pos)
    ws.cell(row=r, column=2, value=status)
    ws.cell(row=r, column=3, value=src)
    ws.cell(row=r, column=1).alignment = WRAP
    ws.cell(row=r, column=3).alignment = WRAP
    r += 1
for row_i in range(start - 1, r):
    for col_i in range(1, 4):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [34, 40, 70])
ws.freeze_panes = "A2"
print("Sheet 13 done")

# ============================================================================
# 14. РИСКИ
# ============================================================================
ws = add_sheet("Риски")
r = disclaimer_block(ws, 1, 4)
r += 1
for i, h in enumerate(["№", "Риск", "Последствие", "Рекомендация"], start=1):
    ws.cell(row=r, column=i, value=h)
style_header_row(ws, r, 4)
r += 1
risks = [
    ("Отсутствие инженерно-геологических изысканий",
     "Неверные допущения по УГВ, грунту, основанию -> ошибки в расчёте плиты, стен, всплытия",
     "Заказать изыскания ДО разработки рабочего проекта"),
    ("Всплытие конструкции при высоком УГВ (FS~1,1-1,2 в предв. расчёте)",
     "Подъём/раскрытие швов, потеря герметичности, повреждение конструкций",
     "Уточнить УГВ; рассмотреть утяжеление, консоль плиты, анкеры"),
    ("Невозможность мембранной гидроизоляции («белая ванна»)",
     "Риск фильтрации через рабочие швы и трещины при отсутствии контроля качества бетона",
     "Гидрошпонки+инъекционные шланги+кристаллизующиеся добавки; строгий контроль швов"),
    ("Отсутствие расчёта на боковое давление грунта по факту грунта участка",
     "Недостаточное/избыточное армирование стен",
     "Расчёт по фактическим γ, φ грунта после изысканий"),
    ("Не определён класс защитного сооружения ЦЗ",
     "Толщины/армирование/двери могут не соответствовать требуемому классу защиты",
     "Определить класс защиты с проектировщиком до выпуска рабочего проекта"),
    ("Конкретные двери/люк не подобраны (нет паспортов изделий)",
     "Несоответствие проёмов, закладных, посадочных мест реальному изделию",
     "Подобрать изделия и скорректировать проёмы/закладные по паспорту"),
    ("Приблизительность объёмов бетона и арматуры (укрупнённая методика)",
     "Отклонение фактического расхода материалов от сметы",
     "Уточнить после разработки полных рабочих чертежей"),
    ("Цены в смете ориентировочные (часть — веб-поиск, часть — экспертная оценка)",
     "Отклонение бюджета от рыночных цен на момент закупки",
     "Получить актуальные коммерческие предложения от поставщиков/подрядчиков"),
]
start = r
for num, (risk, impact, rec) in enumerate(risks, start=1):
    ws.cell(row=r, column=1, value=num)
    ws.cell(row=r, column=2, value=risk)
    ws.cell(row=r, column=3, value=impact)
    ws.cell(row=r, column=4, value=rec)
    for c in (2, 3, 4):
        ws.cell(row=r, column=c).alignment = WRAP
    r += 1
for row_i in range(start - 1, r):
    for col_i in range(1, 5):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [4, 40, 40, 40])
ws.freeze_panes = "A2"
print("Sheet 14 done")

# ============================================================================
# 15. ВОПРОСЫ ИНЖЕНЕРУ / ПОДРЯДЧИКУ
# ============================================================================
ws = add_sheet("Вопросы инженеру")
r = disclaimer_block(ws, 1, 3)
r += 1
ws.cell(row=r, column=1, value="ВОПРОСЫ ЛИЦЕНЗИРОВАННОМУ ИНЖЕНЕРУ-КОНСТРУКТОРУ").font = RED_BOLD
r += 1
for i, h in enumerate(["№", "Вопрос"], start=1):
    ws.cell(row=r, column=i, value=h)
style_header_row(ws, r, 2)
r += 1
eng_questions = [
    "Какой класс защитного сооружения ЦЗ требуется/достижим для данного объекта и участка?",
    "Достаточна ли толщина/армирование плит и стен с учётом фактической геологии и нагрузок?",
    "Каков итоговый коэффициент устойчивости на всплытие и какие меры необходимы (утяжеление/анкеры/консоль)?",
    "Какая система гидроизоляции («белая ванна») рекомендуется с учётом невозможности мембраны?",
    "Достаточно ли предварительное усиление проёмов (Ø16) или требуется отдельный расчёт?",
    "Какие нормативные документы (ДБН/ДСТУ) применимы в финальной редакции на дату проектирования?",
    "Требуется ли антисейсмическое/динамическое усиление с учётом местных условий?",
    "Каковы требования к защитным дверям (класс, избыточное давление) для выбранного класса защиты?",
]
start = r
for i, q in enumerate(eng_questions, start=1):
    ws.cell(row=r, column=1, value=i)
    ws.cell(row=r, column=2, value=q)
    ws.cell(row=r, column=2).alignment = WRAP
    r += 1
r += 1
ws.cell(row=r, column=1, value="ВОПРОСЫ ПОДРЯДЧИКУ ПЕРЕД ПОДПИСАНИЕМ ДОГОВОРА").font = RED_BOLD
r += 1
for i, h in enumerate(["№", "Вопрос"], start=1):
    ws.cell(row=r, column=i, value=h)
style_header_row(ws, r, 2)
r += 1
contractor_questions = [
    "Подтверждаете ли вы объёмы бетона/арматуры по факту рабочих чертежей (не по этому черновику)?",
    "Какой конкретный завод-изготовитель бетона и способ доставки/подачи (миксер, насос) будет использован?",
    "Какие сроки и условия гарантии на гидроизоляцию швов («белую ванну»)?",
    "Какая модель защитно-герметичной и внутренней герметичной дверей предлагается и её паспортные данные?",
    "Кто выполняет и кто несёт ответственность за качество рабочих швов бетонирования?",
    "Предусмотрен ли технический надзор и промежуточная приёмка скрытых работ (арматура, гидроизоляция)?",
    "Как будет организован водоотлив на период строительства при возможном притоке грунтовых вод?",
    "Какова итоговая твёрдая/ориентировочная цена и порядок расчётов, привязанный к этапам работ?",
]
start2 = r
for i, q in enumerate(contractor_questions, start=1):
    ws.cell(row=r, column=1, value=i)
    ws.cell(row=r, column=2, value=q)
    ws.cell(row=r, column=2).alignment = WRAP
    r += 1
for row_i in range(start - 1, r):
    for col_i in range(1, 3):
        ws.cell(row=row_i, column=col_i).border = BORDER
autosize(ws, [4, 100])
ws.freeze_panes = "A2"
print("Sheet 15 done")

wb.save(XLSX_PATH)
print("SAVED:", XLSX_PATH)
