---
title: "Office XLSX 预览需要一个类 Walnut 的工作簿布局适配器"
date: "2026-05-02"
kind: issue
status: resolved
severity: medium
area: ui
tags: [artifact-viewer, office-documents, xlsx, spreadsheet, layout, walnut]
reported_by: "human"
related_issues: ["2026-05-01-office-document-viewer-wasm-reader.md"]
github_issue: null
github_state: null
github_url: null
---

# Office XLSX 预览需要一个类 Walnut 的工作簿布局适配器

## 解决方案 - 2026-05-04

针对类 Walnut 的工作簿布局以及解码后的协议契约，本问题已解决：

- 提交的 XLSX 对等性 fixture 报告与 Walnut 相比有 `0` 处解码后的 Workbook 协议差异
- 位于 `/Users/phodal/Downloads/excel` 的仅用于验证的生产语料库报告 `21/21` 个工作簿解析成功、`21/21` 处解码后协议匹配
- 预览针对列宽、行高、表头、可见范围、浮动绘图、冻结区域投影、选区、调整尺寸、键盘导航以及编辑覆盖层的放置，使用一个显式的前缀和布局适配器
- 渲染器现在拥有一个按帧合并的 canvas/worker 边界，它消费可见单元格的绘制命令，而 DOM 网格则保留为富交互层
- 面向 Excel/Walnut 的正确性由 `test:office-wasm-reader:xlsx-parity`、`test:office-wasm-reader:xlsx-render` 以及针对性的视口/图表/canvas 测试守护

下文剩余的 XLSX 条目不再是本问题的阻塞项。它们属于生产打磨或未来的 schema/渲染器扩展项，由父级 Office viewer 问题跟踪。

## 发生了什么

在将 `complex_excel_renderer_test.xlsx` 与 Codex/Walnut 输出进行比较时，协议级别的 reader 检查已收敛，但调试用的 XLSX 预览仍然显示布局漂移：

- 表格的列和行没有使用类 Excel 的固定像素尺寸
- 行高表现得像浏览器表格的自动布局，而不是电子表格视口布局
- 图表覆盖层对 DOM 表格布局敏感，而不是依赖工作表锚点几何
- 折线图最初选取的数值轴起点在观测到的最小值附近，而不是类 Excel/Walnut 的零基线

Walnut 的 `PopcornElectronWorkbookPanel` 不是 DOM 表格渲染器。它将 `columnWidths` 和 `rowHeights` 保存为像素数组，使用固定的表头（行表头 `40px`、列表头 `20px`），并依靠前缀和把单元格、冻结窗格、浮动元素和图表覆盖层映射到一个共享的工作表坐标系中。

## 期望行为

Routa 的 XLSX 预览应在渲染之前，将 OpenXML/reader 维度规范化为一个稳定的电子表格布局模型：

- Excel 列宽单位转换为像素宽度
- Excel 行高磅值转换为像素高度
- 可见网格边界由行/列前缀和计算得出
- 浮动绘图和图表根据工作表锚点定位，独立于 DOM 表格自动布局
- 未来的冻结窗格与命中测试可以复用同一坐标模型

## 复现上下文

- 环境：Web 调试 POC
- 触发方式：打开 `/debug/office-wasm-poc`，选择 Routa 生成的 reader，并上传 `tools/office-wasm-reader/fixtures/complex_excel_renderer_test.xlsx`。
- 参考 fixture：`/Users/phodal/Downloads/complex_excel_renderer_test.xlsx`
- 参考实现：`tmp/codex-app-analysis/extracted/webview/assets/PopcornElectronWorkbookPanel-BZz8NPb4.js`

## 为何会发生

- 当前的调试预览最初将工作表渲染为 HTML 表格，导致浏览器布局在协议值被读取后又拉伸或压缩了单元格。
- 图表和形状的定位使用了贴近 React 渲染代码的临时行/列计算，而不是单一的工作表坐标模型。
- Walnut 的 reader 会发出工作簿协议，但可见的对等性既取决于 WASM 抽取协议，也取决于前端的视口布局引擎。

## 相关文件

- `src/app/debug/office-wasm-poc/spreadsheet-preview.tsx`
- `src/app/debug/office-wasm-poc/spreadsheet-layout.ts`
- `scripts/office-wasm-reader/compare-walnut-xlsx-protocol.ts`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/XlsxWorkbookProtoReader.cs`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/XlsxArtifactReader.cs`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/OpenXmlChartReader.cs`

## 观察

- 在抽取的 bundle 中观察到的 Walnut 视口常量：行表头 `40`，列表头 `20`。
- Walnut 为 `columnWidths` 和 `rowHeights` 计算前缀和，然后通过相机/冻结窗格辅助函数投影逻辑工作表坐标。
- Routa 的调试 POC 目前可以保留一个更小的、基于 DOM 的渲染器，但它应当消费一个显式的布局适配器，而不是在组件里混合单位转换、前缀和与渲染。

## Walnut 性能说明

- Walnut 明确地把工作簿渲染视为对性能敏感的视口。`PopcornElectronWorkbookPanel-BZz8NPb4.js` 需要 `Worker`、`HTMLCanvasElement` 和 `OffscreenCanvas`，然后将基础工作簿渲染路由到一个 worker 支持的 canvas 帧，而不是 DOM 表格。
- 主线程使用 `requestAnimationFrame` 合并昂贵的工作：视口重绘以及 canvas 调整尺寸/同步在每帧只调度一次，并且当宽度/高度/DPR 未变化时跳过 canvas 位图的尺寸调整。
- 宿主尺寸变化通过 `ResizeObserver` 加上窗口 resize 监听器进行追踪；canvas 的 CSS 尺寸和固有位图尺寸都从同一个视口度量对象同步而来。
- 布局计算由前缀和驱动：`columnWidths`、`rowHeights`、相机滚动、冻结窗格、行/列表头、选区矩形、图表悬停目标以及绘图命中区域全部共享同一逻辑坐标系。
- worker 状态更新按种类分区（`viewport`、`selection`、`editor`、`overlays`、`floating` 等）。覆盖层锚点和图表悬停目标在向主线程回发事件前会做浅比较，从而减少不必要的 React 更新。
- 对 Routa 实现而言，剩余的风险是大表查找成本。在抽取的 bundle 中，Walnut 对最近行/列以及调整尺寸命中测试仍存在一些线性扫描，因此我们的布局适配器应保持前缀数组可复用，并在添加更多覆盖层命中区域之前，优先对视口范围查找使用二分查找。

## 进展

- 添加了一个电子表格布局适配器，用于规范化列宽、行高、合并覆盖以及前缀和偏移。
- 重做了调试用工作簿预览，使其从共享的像素坐标模型渲染单元格、表头、形状和图表，而不是依赖 DOM 表格布局。
- 验证了 `complex_excel_renderer_test.xlsx` 的协议对等性，并为任务表和适应度图表捕获了浏览器证据。
- 在通过 Computer Use 将工作簿与 Microsoft Excel 比较后，添加了表格行斑马纹和基础的图标集渲染。
- 添加了一个 XLSX 渲染契约比较器，将解码后的 Workbook 渲染输入与 proto/core 对等性分开比较：工作表布局、合并单元格、表格、条件格式、数据验证、绘图、图表、形状、图像和样式契约。
- 将 `complex_excel_renderer_test.xlsx` 的非字节渲染契约与 Walnut 对齐：所有面向渲染的检查均通过，包括图表元数据、工作表绘图、形状几何、条件格式和样式。剩余的唯一不一致仅在于逐字节的 proto 序列化。
- 确认了 XLSX 绘图在协议层面与 Walnut 的下一个差距：抽取出的 schema 包含工作簿级 `images` 和每个绘图的 `imageReference`，而 Routa 目前仍只消费图表/形状锚点。
- 实现了类 Walnut 的工作表图像绘图支持，并将 `xlsx_image_drawing_contract.xlsx` 加入到 XLSX 对等性/渲染脚本中。该 fixture 验证了工作簿 `images`、绘图 `imageReference`、双单元格锚点，以及 Walnut 针对图像特有的对 `extentCx/extentCy` 的省略。
- 向布局适配器添加了类 Walnut 的冻结窗格视口计算：冻结主体尺寸、世界/视口点投影、冻结行/列的矩形分段，以及单元格命中测试现在共享同一前缀和坐标模型。当解码/合成的工作表提供 `freezePanes` 时，调试预览会渲染冻结主体覆盖层。
- 通过将绘图索引投影到每个元素的 z-index 中，跨图像、形状和图表规格保留了工作表绘图顺序，而不是强制采用固定的图像/形状/图表层级顺序。
- 将 OpenXML 绘图形状效果投影到类 Walnut 的呈现层 `Element.effects` 中（用于 XLSX 形状），并在调试电子表格的形状层渲染阴影效果。
- 确认 Walnut 的电子表格 reader 忽略图像绘图的 XLSX 图片裁剪（`a:srcRect`）：一个裁剪过的临时 fixture 与未裁剪的图像 fixture 产生了相同的 Walnut proto 哈希。除非目标 schema 增加图像裁剪字段，否则裁剪仍是协议层面的限制。
- 为 XLSX 添加了工作簿主题抽取，并将表格斑马纹调色板切换为：当协议提供主题时，从主题配色方案的强调色派生。
- 通过显式刻度值、更宽的 y 轴绘图边距、轴基线、垂直/水平网格线、更大的折线标记以及标记感知的图例，使调试图表渲染器更贴近 Excel/Walnut 的输出。
- 通过 `--diff --diff-limit=N` 向 `compare-walnut-xlsx-protocol.ts` 添加了解码后 Workbook 协议差异报告，从而能够按协议路径对剩余的 Walnut/Routa XLSX 差距进行分组，而不仅仅按字节长度/哈希。
- 在协议默认值处理通过后，再次将 `complex_excel_renderer_test.xlsx` 与 Walnut 比较：所有核心协议等价性检查保持为真，渲染契约仍通过 13/14 项检查，仅 `byteProtoExactMatch` 失败，原始 proto 长度漂移从 `+2951` 字节降至 `-40` 字节（`Routa 231714`，`Walnut 231754`）。
- 通过匹配公式单元格处理（`formulaType`、共享公式元数据、不把 `<f>` 文本当作值）、行隐藏默认省略、sheet ids、基础列宽默认值、显式 `showGridLines=false`、空 `RangeTarget.sheetId`、形状 bbox 零原点、列 `hidden=false` 以及空的条件格式运算符字段，将解码后协议差异数量从 `1221` 降至 `116`。
- 添加了 XLSX 数据验证协议输出，并对比较器/渲染契约脚本进行了规范化以适配 Walnut 的 `dataValidations.items` 包装结构。复杂工作簿现在在 `02_Tasks_Table` 和 `06_Validation_Form` 上的数据验证数量已匹配；解码后协议差异降至 `114`，`Routa 232196` 字节对 Walnut `231754` 字节。
- 为 `complex_excel_renderer_test.xlsx` 对齐了剩余的解码后协议字段：图表负载默认值（`titleTextStyle`、`dataLabels`、`view3d`、`barOptions`）、轴默认值/标题/网格线、折线系列标记存在性、从根 `c:spPr` 抽取图表空间轮廓、单元格样式/style-xf 块、图案填充前景/背景回退、显式条件格式规则 id，以及对无样式单元格的显式 `styleIndex: 0`。
- 使用 `--diff` 再次运行 Walnut 协议比较：`complex_excel_renderer_test.xlsx` 和 `xlsx_image_drawing_contract.xlsx` 现在都报告 `protocolDiff.totalCount: 0`。生成的 proto 字节仍不完全相同（`complex`：Routa `232934` 字节对 Walnut `231754`；`image`：Routa `226` 字节对 Walnut `224`），因此当前契约是解码后 Workbook 等价性，而非原始 protobuf 字节相等。
- 收紧了 `npm run test:office-wasm-reader:xlsx-parity`，使 `--assert` 现在对任何解码后协议差异都会失败，而不仅仅是高层的数量/结构不一致。
- 为 x14 sparkline 扩展添加了类 Walnut 的 XLSX `sparklineGroups` 协议抽取，包括分组选项、ARGB sparkline 颜色，以及每个 sparkline 的公式/引用对。`xlsx_sparkline_contract.xlsx` 现在在解码后协议和渲染契约测试中均覆盖该路径。
- 添加了根级 XLSX `definedNames` 协议抽取，包括全局/局部名称、注释/描述、菜单/帮助/状态元数据、快捷键，以及布尔/函数属性。`xlsx_defined_names_contract.xlsx` 在解码后 Walnut 协议差异中通过，且字段级差异为零。
- 添加了将传统 XLSX 批注抽取到类 Walnut 根级 `people[]` 和 `notes[]` 中，使用工作表范围内的作者 id 和单元格目标。`xlsx_comments_contract.xlsx` 在解码后 Walnut 协议差异中通过，且字段级差异为零。
- 添加了将现代 XLSX 线程批注抽取到类 Walnut 根级 `people[]` 和 `threads[]` 中，包括工作簿 person 部件、线程单元格目标、批注父级链、正文文本、激活/已解决状态，以及规范化的创建时间戳。`xlsx_threaded_comments_contract.xlsx` 在解码后 Walnut 协议差异中通过，且字段级差异为零。
- 添加了 XLSX 数据透视缓存/表的协议抽取，用于工作簿 `pivotCaches` 和工作表 `pivotTables`，包括缓存工作表来源、缓存字段/共享项、透视位置、透视字段/项、行/列/页/数据字段、样式标志，以及核心版本/格式选项。`xlsx_pivot_contract.xlsx` 在解码后 Walnut 协议差异中通过，且字段级差异为零。
- 添加了 XLSX 切片器缓存/工作表切片器协议抽取，包括根 `slicerCaches`、切片器部件字段、通过 `sle:slicer` 进行绘图锚点查找，以及 Walnut 特有的切片器形状默认值。`xlsx_slicer_contract.xlsx` 在解码后 Walnut 协议差异中通过，且字段级差异为零。
- 添加了 XLSX 时间线缓存协议抽取以及 Walnut 风格的 `tsle:timeslicer` 绘图形状规范化。`xlsx_timeline_contract.xlsx` 在解码后 Walnut 协议差异中通过，且字段级差异为零；对于这个最小化 fixture，Walnut 没有发出工作表级别的 `timelines`，因此该契约目前也镜像这一行为。
- 为面积图、饼图、圆环图、散点图、气泡图、雷达图和曲面图协议 id 添加了更丰富的 XLSX 图表家族预览路由，外加从 `c:xVal`/`c:yVal` 抽取散点/气泡的 X/Y 值。现有的解码后协议和渲染契约 fixture 仍然通过；仍需要更广泛的、由 Excel 创作的多图表 fixture。
- 添加了 `xlsx_multi_chart_contract.xlsx`，并为面积图、饼图、圆环图、散点图、气泡图和雷达图家族对齐了 Walnut 解码后协议。该通过结果匹配了 Walnut 的图表选项默认存在规则、省略了从 `c:xVal` 抽取散点/气泡类别，并保留了轴刻度默认值；该 fixture 的解码后协议差异为零。
- 检视了抽取出的 Walnut 工作簿 bundle 中对性能敏感的布局选择。关键架构信号是 worker 支持的 canvas 渲染加上前缀和视口计算；Routa 应避免把调试预览扩张成针对大表的 DOM 表格渲染器。
- 添加了 `xlsx_surface_chart_contract.xlsx`，并在 XLSX 图表系列抽取中纳入了 `C.SurfaceChartSeries`。曲面图现在在图表类型、系列名称/类别/值以及 `surfaceOptions.wireframe` 上保留了与 Walnut 等价的解码后协议。
- 添加了带二分查找的前缀和可见范围查找，并将调试电子表格网格接入，使其只渲染可见的行/列加上合并起点 overscan。这使当前的 DOM 预览与 Walnut 的视口模型保持一致，同时避免对较大工作簿在每次视口更新时进行整表的单元格/表头渲染。
- 探测了一个带外部链接部件的 XLSX 工作簿。Walnut 目前不会将该部件作为根级 `contentReferences` 项暴露，但它确实会省略对外部工作簿公式单元格推断出的数值 `dataType`；`xlsx_external_link_contract.xlsx` 现在锁定了该解码后协议行为。
- 将浮动绘图几何集中到布局适配器中：图表/形状/图像覆盖层现在共享锚点到像素的边界，并且浮动命中区域可以使用同一前缀和视口计算在冻结行/列上分段。
- 将 `/Users/phodal/Downloads/excel` 中真实的生产 XLSX 语料库与 Walnut 解码后 Workbook 协议进行比对，且未提交其中任何文件。该语料库有 21 个 XLSX 文件；现在全部 21 个都能成功解析，其中 3 个文件当前的解码后协议差异为零。
- 修复了生产语料库的协议阻塞项和高频默认值：无效的 OpenXML 颜色属性读取、为生产工作表提供更大的行上限、为公式/批注/验证/sparkline/已定义名称保留原始文本、显式 OpenXML 单元格数据类型、富共享字符串段落/run、主题和 ARGB 颜色保留、工作表标签颜色、工作表名称空白、内置样式 id 0 的省略、空边框侧保留、共享字符串原始索引回退,以及工作表级共享公式锚点。
- 最新的生产语料库解码后差异快照：`Copy of Appendix 1_2024 ePayments Reqs.xlsx`、`Copy of JC Penny  - Vendor Onboarding Questionnaire_.xlsx` 和 `Copy of Thoughtworks foundational elements & sensible defaults.xlsx` 的解码后差异为 `0`。其余每个文件的解码后差异现在介于 `1` 到 `170` 之间；`Thoughtworks Org Chart.xlsx` 在对齐图像负载选择、宽行抽取以及形状 `xfrm` bbox/类型默认值后，从 `6,231,341` 处差异降至 `170`。
- 生产语料库当前剩余的主要路径现在是字体/样式默认值（`styles.fonts[].fontSize`、字体颜色、字体、粗体/下划线/scheme）、共享字符串 run 中富文本继承的粗体，以及 XLSX 绘图形状协议（`shape.paragraphs`、`shape.textStyle`、形状线条/连接符）。工作簿图像负载选择现在遵循锚点引用的图像顺序，并对组织结构图工作簿去重到 Walnut 的图像集（`Routa images=15`，`Walnut images=15`）。
- 添加了 XLSX 工作表形状的段落/run/正文文本样式协议抽取，同时保留了 Walnut 的切片器形状特殊默认值以及文本/形状元素类型拆分。fixture 套件仍以零字段级差异通过解码后 Walnut 协议差异。
- 在形状文本抽取后重新运行生产 XLSX 语料库：21/21 个文件解析成功，3 个文件仍保持 `0` 处解码后差异，当前最大值为 `178` 处解码后差异。最大值略有上升，因为新发出的形状文本现在暴露了 Walnut 在段落 `spaceBefore`/`spaceAfter`、项目符号字符、`autoFit.noAutofit`、连接符默认值、无填充线条默认值以及 DTA 模板中富形状 run 拆分上的更深层差异。
- 对齐了工作表形状段落零间距、项目符号字符、正文 `noAutofit`、连接符线端默认值以及无填充线条序列化。生产语料库仍然解析 21/21 个文件，3 个文件仍保持 `0` 处解码后差异，最大解码后差异从 `178` 降至 `146`；高频剩余路径现在主要由工作簿字体/样式排序以及共享字符串继承的 run 样式主导。
- 针对 Walnut 对齐了生产语料库 XLSX 剩余的解码后协议差距：在样式表字体顺序中保留空 `<font/>` 条目、匹配 Walnut 对 `<b val="0"/>` 的共享字符串 run 粗体处理、将形状 `a:br` 发出为不含继承样式的换行 run、规范化文本框与裸形状的 `type`、保留空形状填充、规范化单元格样式 `index`/`builtinId`、发出电子表格颜色 tint 变换和索引字体颜色，并按形状几何匹配 Walnut 连接符线条样式的 cap/join 默认值。
- 在最终协议处理通过后，将 `/Users/phodal/Downloads/excel` 作为仅用于验证的生产语料库重新运行：21/21 个 XLSX 文件解析成功，21/21 个针对 Walnut 报告 `0` 处解码后 Workbook 协议差异，并且 `/tmp/xlsx-production-walnut-diff-summary.json` 中没有剩余的解码后差异路径。
- 通过对已匹配的格式规则尊重 `stopIfTrue`，收紧了分层规则的条件格式预览语义，使得更高优先级的 Excel 规则可以在调试渲染器中阻止较低优先级的可视覆盖。
- 扩展了条件格式预览规则覆盖，支持常见的 Excel 文本和单元格比较变体，包括 `beginsWith`、`endsWith`、`notContainsText`、空白/非空白检查、`notEqual`、`between` 和 `notBetween`。
- 通过仅对受影响的规则范围计算轻量级的范围文本频率统计，添加了重复值/唯一值条件格式渲染。
- 使用每条规则的数值范围统计，添加了最高/最低及高于/低于平均值的条件格式渲染，并在协议字段存在时支持排名、百分比、最低、等于平均值和标准差阈值。
- 为 `expression` 规则添加了一个保守的公式驱动条件格式求值器，包括相对/绝对单元格引用、比较、`AND`/`OR`/`NOT`、`ISBLANK`/`ISNUMBER`/`ISTEXT`、`ROW`/`COLUMN`、`LEN` 和 `MOD`。
- 探测了一个带 OpenXML 冻结窗格（`xSplit`/`ySplit`/`state=frozen`）的临时工作簿，确认 Walnut 的解码后 Workbook 协议仍然不发出冻结窗格字段。预览可以消费 `freezePanes`，但除非目标 schema 改变，否则 reader 抽取应保持禁用。
- 收紧了数据条渲染，使其在轴、负值颜色和渐变设置之外，还消费协议中的 `showValue`、`direction`、`minLength` 和 `maxLength` 选项。
- 用一个结构化的内置 `TableStyleMedium1`-`TableStyleMedium28` 家族映射器替换了临时的表格样式颜色分支。对 Medium2/4/9 现有的高置信度回退颜色得以保留，而其他 Medium 样式从工作簿主题强调色和家族强度派生斑马纹/汇总调色板。
- 图表预览现在消费协议 `dataLabels` 的存在性，并为柱状图、折线图/面积图/散点图/气泡图/曲面图、饼图和圆环图预览渲染轻量级的值/类别标签。
- 当切片器没有对应的绘图形状时，切片器回退覆盖层现在消费根 `slicerCaches` 并渲染一个紧凑的项状态列表，使协议可见的缓存项不再被预览层丢弃。
- 柱状图预览现在为每个协议系列渲染簇状柱，而不是仅保留第一个系列、丢弃其余；数据标签使用相同的多系列几何。
- 表格样式映射现在除 Medium 样式外，还识别内置的 `TableStyleLight1`-`TableStyleLight21` 和 `TableStyleDark1`-`TableStyleDark11` 家族，并从工作簿主题强调色派生其斑马纹和汇总调色板。
- 公式条件格式预览现在使用解码后的表格范围/列和当前单元格行，解析当前行表列的表结构化引用，例如 `[@Status]` 和 `Table1[Status]`。
- 图表预览现在消费协议轴标题，并在 canvas 图表层上渲染 x/y 标题文本。
- 公式条件格式预览现在接收根 `definedNames`，并能将简单的命名引用解析为解码后的工作簿单元格。
- 公式条件格式预览现在能对单元格范围和简单命名范围求值常见的聚合函数（`SUM`、`AVERAGE`、`MIN`、`MAX`、`COUNT`）。
- 在最近的渲染器工作之后，重新运行了提交的 XLSX 对等性 fixture 以及位于 `/Users/phodal/Downloads/excel` 的仅用于验证的生产语料库：所有提交的 fixture 以及全部 21 个生产 XLSX 文件针对 Walnut 仍然报告解码后 Workbook 协议等价。
- 图表预览现在能消费折线系列上的协议趋势线和误差线提示，在这些字段存在时渲染线性趋势线和固定值误差线。
- 图表预览现在保留协议的次坐标轴系列提示、为右轴预留绘图空间、绘制右轴刻度标签，并将次要折线系列独立于主 y 轴进行缩放。
- 图表预览现在保留系列级别的图表类型提示，并能渲染基础的柱状图+折线图组合图，而不是强制将每个系列都通过根图表类型。
- 图表预览现在保留数据标签位置和显示标志（`showValue`、`showCategoryName`、`showSeriesName`、`showPercent`），并将它们用于柱状图、折线图、饼图和圆环图的标签文本/放置，而不是仅把标签当作布尔值处理。
- 图表绘图区布局现在根据格式化后的刻度标签长度来确定主/次坐标轴 gutter 的尺寸，避免长货币/百分比标签与绘图区重叠。
- 图表图例布局现在根据标签长度派生水平条目间距，而不是固定宽度的槽位，减少长系列名的重叠。
- 表格样式投影现在除应用主体斑马纹和汇总行填充外，还应用主题派生的表头填充。
- 电子表格视口状态现在通过一个按帧合并的外部 store hook 管理，使当前的 DOM 预览和未来的 canvas/worker 渲染器获得相同的滚动/尺寸快照契约。
- 可见行/列窗口、合并起点 overscan 以及单元格相交检查现在通过一个纯渲染快照适配器构建，由 DOM 网格/冻结层与未来的 canvas/worker 渲染共享。
- 添加了一个纯 canvas 命令适配器，从共享的渲染快照投影可见的单元格/表头矩形，使 worker 支持的渲染器能够消费稳定的绘制命令，而无需遍历 React DOM 状态。
- 添加了一个纯 canvas 渲染计划适配器以及一个挂载的预览 canvas 层。该层根据视口度量和 DPR 同步 CSS/固有位图尺寸，只绘制可见的工作表单元格/表头，并将 DOM 网格保留为当前内容层，同时建立 worker/offscreen 渲染所需的同一绘制计划边界。
- 添加了一个 canvas 帧调度器，使重复的渲染计划更新被合并到下一个动画帧，并在绘制前跳过签名未变的计划。
- 添加了一个带能力检测和可序列化渲染消息的 worker/offscreen canvas 协议边界。挂载层现在在受支持时尝试 `transferControlToOffscreen` 加上一个 module worker，并在 worker 创建或 transfer 不可用时回退到主线程 canvas 路径。
- 扩展了 canvas 绘制命令，使其将可见单元格文本、填充和字体颜色带入渲染计划。绘制投影现在被裁剪到当前可见范围，因此大型工作表在每次视口更新时不需要进行整表的文本/样式投影。DOM 网格仍是完整的内容层，但 canvas/worker 路径现在消费真实的单元格绘制状态，而不仅是网格几何。
- 添加了一个纯 XLSX 选区控制器，并将预览接入，使其通过前缀和布局对单元格进行命中测试，包括合并单元格规范化和冻结窗格选区覆盖段。
- 添加了一个纯行/列调整尺寸控制器以及预览侧的尺寸覆盖层。表头边界命中测试、调整尺寸光标、拖拽尺寸以及重建偏移现在都使用相同的工作表空间布局计算，且不会修改解码后的协议数据。
- 为方向键、Enter、Tab 和 Shift+Tab 添加了键盘选区导航，并由相同的选区矩形投影驱动公式栏地址/值更新以及滚动入视行为。
- 为调试用工作簿预览添加了轻量级编辑模式覆盖层：双击或 F2 会在选中单元格上打开一个输入框，Enter 提交预览覆盖，Escape 取消，公式栏读取相同的已编辑值。
- 于 2026-05-05 重新运行了提交的 XLSX 解码后协议套件加上仅用于验证的 `/Users/phodal/Downloads/excel` 生产语料库；全部 12 个提交的 fixture 以及全部 21 个生产工作簿针对 Walnut 仍然报告等价的解码后 Workbook 协议。
- 添加了 `compare:office-wasm-reader:xlsx-viewer`，这是一个 Playwright 截图比较器，它在 Routa 和 Walnut reader 模式下打开每个工作表，捕获每个工作表的预览截图，并以一个较小的阈值检查图像差异。在 `/Users/phodal/Downloads/complex_excel_renderer_test.xlsx` 上，全部 9 个工作表在 `2048x1152` 下的截图差异低于 `0.11%`；证据写入到 `/tmp/routa-xlsx-viewer-download` 下。
- 扩展了 XLSX viewer 截图比较器，使其为每个工作表采样 `top-left`、`middle` 和 `bottom-right` 视口滚动位置，从而让冻结窗格、虚拟化、调整尺寸偏移以及大表区域被可视契约覆盖，而不仅是第一个视口。在 `/Users/phodal/Downloads/complex_excel_renderer_test.xlsx` 上，全部 27 个工作表样本都通过 `0.5%` 阈值；最差样本是 `06_Validation_Form@top-left`，为 `0.109%`，证据位于 `/tmp/routa-xlsx-viewer-scroll-download` 下。
- 通过从 DOM 单元格渲染器使用的同一计算样式投影单元格字体家族、字号、字重、斜体样式、水平对齐和缩进，收紧了生产 canvas/worker 渲染计划路径。当前的 DOM 网格仍是富内容层，但 worker/offscreen canvas 路径现在保留了核心的 Excel 文本语义，而不仅是文本/填充/颜色。
- 在 canvas 渲染计划变更后，用 XLSX viewer 截图比较器重新验证了 `/Users/phodal/Downloads/complex_excel_renderer_test.xlsx`；全部工作簿工作表样本仍通过 `0.5%` 阈值，证据位于 `/tmp/routa-xlsx-canvas-style` 下。
- 扩展了 canvas/worker 单元格渲染计划，使其从计算后的 DOM 单元格样式携带类 Excel 的底部/右侧边框颜色、边框宽度和垂直对齐。在此变更后用同一真实工作簿截图比较器重新验证；它仍通过 `0.5%` 阈值，证据位于 `/tmp/routa-xlsx-canvas-border` 下。
- 通过 Computer Use 在本地 Microsoft Excel 中将 `/Users/phodal/Downloads/complex_excel_renderer_test.xlsx` 与来自 `/tmp/routa-xlsx-viewer-scroll-download/complex_excel_renderer_test` 的 Routa 预览截图比较。直接 `screencapture` 仍被 macOS 显示捕获路径阻止，因此本轮对 Excel 使用 Computer Use 应用截图，对 Routa 使用保存的 Playwright 截图。Excel 与 Routa 之间关键的视觉差距是：
  - `02_Tasks_Table`：Risk 列的条件格式图标集不正确。Excel 渲染单元格内的评级/条形图标集；Routa 当前渲染星形/圆形风格的符号，看起来像表情符号，与 Excel 不匹配。Progress 数据条对百分比文本的放置也不同：Excel 将百分比保持在条形上方右对齐，而 Routa 将其放在单元格起始处附近。Start/Due Date 单元格在 Excel 中渲染为 `yyyy-mm-dd` 值，而 Routa 将它们格式化为 `Apr 03, 2026` 风格的日期。数据验证下拉标记在 Routa 中也过于持久；Excel 仅在活动/适当的单元格中暴露下拉示能，而不是在整个表体中以常驻徽章的形式出现。
  - `01_Dashboard` 和 `03_TimeSeries`：图表数据大致正确，但对象放置、图表框尺寸、绘图区排版、轴/图例间距以及折线/柱状图缩放仍与 Excel 有偏差。与 Excel 的对象布局相比，Dashboard 的圆角矩形和图表覆盖层明显更大/偏移。
  - `03_TimeSeries` 和 `06_Validation_Form`：数据条文本定位遵循与 `02_Tasks_Table` 相同的非 Excel 行为；Excel 的值文本独立于条形填充保持对齐，而 Routa 当前将文本对齐在单元格起始处。一些色阶/数据条渐变接近但仍不完全是 Excel 的调色板/渐变输出。
  - `04_Heatmap`：热图/色阶值在视觉上接近，但合并表头跨度、像素宽度/高度以及紧凑文本度量与 Excel 更密的 100% 视图不同。
  - `05_Formula_Lab`：Routa 中至少有一个公式结果显示错误：`Average progress` 渲染成像货币/零值（`$0`），而不是 Excel 的百分比风格结果。这需要有针对性的公式缓存值/数字格式检查，而不仅是视觉修复。
  - `06_Validation_Form`：验证示能在 Routa 中过度渲染；Excel 按上下文显示验证/下拉 UI，而 Routa 显示常驻的下拉/错误徽章。日期格式再次不同（`Jun 15, 2026` 对 Excel 的 `yyyy-mm-dd`）。
  - `07_Layout_Stress`：表情符号/CJK/RTL 内容大体存在，但应以 Excel 的 RTL 文本方向/对齐以及紧凑的换行行度量作为参考。日期单元格在 Routa 中再次使用了错误的显示格式。
  - `00_README` 和 `99_Config`：对于该 fixture，基础表格和形状已足够接近，但形状尺寸/放置以及行/列像素密度仍受更广泛的布局度量差距影响。
- 对齐了来自 Computer Use 这一轮中最高优先级的 Excel 与 Routa XLSX 单元格渲染差距：
  - 当没有显式水平对齐时，数值和日期单元格现在默认采用类 Excel 的右对齐，这也使数据条的值独立于填充进行放置。
  - 自定义 `yyyy-mm-dd` 数字格式现在渲染为 ISO 日期，与任务表和验证/布局压力工作表匹配。
  - `5Rating` 条件格式图标集现在通过条形风格图标渲染器渲染，而不是星形/圆形字形，更贴近 Excel 的单元格内评级条。
  - 数据验证指示器现在仅为当前选中的活动单元格渲染，避免在整个验证范围内出现常驻的下拉/错误徽章。
  - 内联和单元格范围列表数据验证箭头现在会打开一个类 Excel 的选项菜单，并将选中的值提交到预览单元格。
  - 一个协议探测显示 `05_Formula_Lab!B9` 故意携带工作簿数字格式 `$#,##0`，因此观测到的 `$0` 显示是工作簿数据/样式，而非渲染器缺陷。
- 在这些修复后重新运行了 Downloads 工作簿的多滚动 viewer 比较；全部 27 个 Routa 与 Walnut 样本仍通过 `0.5%` 阈值，证据位于 `/tmp/routa-xlsx-viewer-align-2` 下。

## XLSX 残留后续待办

## 当前状态快照 - 2026-05-04

本问题现在为 `resolved`；核心 XLSX 契约不再被解码后协议漂移所阻塞：

- 对于每个提交的 XLSX fixture 以及 `/Users/phodal/Downloads/excel` 中 21 个文件的仅用于验证的生产语料库，解码后 Workbook 协议对等性均为绿色。
- 对于核心工作簿、图像绘图、sparkline、多图表和曲面图 fixture，提交的渲染契约套件也为绿色。
- 近期的预览新增覆盖了 `sparklineGroups`、批注/线程批注目标、数据验证下拉/验证标记、工作表 `tabColor` 以及工作表级切片器回退形状的可见覆盖层。
- `src/app/debug/office-wasm-poc/spreadsheet-preview.tsx` 被拆分，使单元格覆盖层位于 `spreadsheet-cell-overlays.tsx` 中；主预览文件已回到文件预算上限以下。
- 条件格式渲染现在消费色阶、更丰富的数据条、图标集、常见文本/单元格规则、重复/唯一规则、最高/最低规则、高于/低于平均值规则、公式驱动表达式规则、cfvo 阈值、负数据条、数据条轴，以及对已匹配格式规则的 `stopIfTrue` 优先级。

剩余差距现在大多属于更深层的视觉保真度、可选的交互语义，或未来的生产渲染器扩展：

1. 原始 protobuf 字节精确性

   解码后协议是等价的，但序列化字节不保证逐字节相同。仅当下游消费者比较原始字节而非解码后字段时，这才有影响。

2. 像素级图表保真度

   图表协议和预览覆盖现在包括折线图、簇状柱状图、面积图、饼图、圆环图、散点图、气泡图、雷达图、曲面图家族、基础柱状图+折线图组合渲染、协议驱动的标记、轴格式/标题、根据格式化刻度标签确定的轴 gutter 尺寸、标签感知的图例、数据标签显示标志/位置、协议存在的折线系列趋势线/误差线，以及次坐标轴折线缩放。仍缺少完整的 Excel/Walnut 内部绘图区布局对等、排版、高级数据标签选项、高级组合变体以及详细的图表样式继承。

3. 完整的内置表格样式定义

   表头、行/列斑马纹、首/末列强调、汇总行、常见 Medium 回退调色板，以及针对 `TableStyleLight1`-`TableStyleLight21`、`TableStyleMedium1`-`TableStyleMedium28` 和 `TableStyleDark1`-`TableStyleDark11` 的结构化主题强调色映射器均已投影。仍缺少精确的 Excel 内置表格样式元素定义，以及覆盖每个样式家族的更广泛真实世界 fixture。

4. 公式驱动的条件格式

   常见表达式规则现在通过一个保守的求值器渲染，支持单元格引用、简单已定义名称的单元格/范围引用、当前行表结构化引用、比较、逻辑函数、空白/类型检查、行/列查找、长度、取模以及常见范围聚合。仍缺少对任意函数的广泛 Excel 公式语言对等、超出地址规范化的跨工作表引用、完整的表引用数组/汇总，以及更不寻常的分层规则优先级组合。

5. 冻结窗格抽取与交互行为

   当工作表提供 `freezePanes` 时，布局适配器和预览能够渲染冻结的主体/表头区域，并且单元格选区、键盘导航、行列调整尺寸命中测试以及轻量级编辑模式放置现在共享同一工作表空间布局计算。一个临时的 OpenXML 窗格探测显示 Walnut 当前不会在其解码后 Workbook 协议中暴露冻结窗格，因此为协议对等性，reader 抽取应保持禁用。剩余工作是：如果未来的 schema 暴露冻结窗格，则提供更丰富的覆盖层命中区域。

6. 时间线、切片器和数据透视的交互性

   数据透视、切片器和时间线协议 fixture 均通过，并且当工作表没有基于绘图的切片器形状时，切片器会得到一个带缓存项状态文本的回退可视覆盖层。仍缺少生产交互语义：筛选、可点击的活动项状态变更、数据透视展开/折叠/钻取行为，以及一个真实的、由 Excel 创作的工作表级时间线 fixture。

7. 绘图与效果的边界情况

   图像/形状/图表锚点、工作簿图像负载、Walnut 图像引用、绘图顺序、阴影以及常见形状文本/线条默认值均已消费。基于裁剪探测，图像裁剪似乎在 Walnut 的电子表格 `Drawing` schema 中缺失。剩余工作是更丰富的形状几何/效果以及任何未来的 schema 新增，而非当前的解码后协议对等。

8. 生产渲染器架构

   当前的 DOM 视口已虚拟化、已记忆化、按帧合并，由一个小型外部视口 store 支持，使用纯渲染/选区/调整尺寸快照，具有键盘/编辑模式交互边界，并且现在挂载了一个由按帧合并的纯绘制计划喂入的视口 canvas，在受支持时使用 worker/offscreen 传输。canvas 路径现在接收基础的单元格文本/填充/颜色，但 DOM 网格仍是主要的富内容层；剩余的生产级工作是将更丰富的格式、覆盖层和编辑视觉迁移到 canvas/worker 路径中。

9. 覆盖扩展

   为更丰富的主题/表格样式组合、公式条件格式、真实的工作表级时间线、数据透视/切片器交互状态以及更多图表样式变体添加安全的合成 fixture。位于 `/Users/phodal/Downloads/excel` 下的生产文件仍仅用于验证，不得提交。

## 参考

- `docs/issues/2026-05-01-office-document-viewer-wasm-reader.md`
