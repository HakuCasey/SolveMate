# 数据资产

数据按课程组织。每门课程下分别维护教材、题目和记忆。

```text
data/
├── calculus/                 # 高等数学，同样包含以下三个目录
└── c-language/               # C 语言
    ├── textbooks/            # 教材内容
    │   └── primer.md
    ├── questions/            # 题目、参考答案和讲解要点
    │   └── questions.json
    └── memory/               # 课程知识要点与讨论点
        ├── learning-points.json
        └── discussion-points.json
```

## 官方内容发布目录

`catalog.json` 声明课程稳定编号、标题、说明、发布名称及允许发布的原文件。它不是个人记录，也不包含服务器路径或凭据。每门课程的四类文件按完整课程打包：教材、题目、记忆点、讨论点。

内容版本由发布工具根据实际 ZIP 字节生成 SHA-256；源目录中的 `release`（例如 `example-1`）只作可读名称。修改原文件后执行发布工具，旧版本仍保留；发布结果是自动生成文件，不回写或覆盖这里的原始资产。具体命令见 [后端说明](../apps/server/README.md)。

## 高等数学

- [示例教材](calculus/textbooks/primer.md)：6 章原创学习材料，包含概念、适用条件、24 道配套题的推导和易错点。
- `questions/questions.json`：24 道原创示例题，保留 M001 至 M024 的稳定编号。
- [记忆点](calculus/memory/learning-points.json)：12 个基于教材与题库提炼的知识要点，附常见误区及来源。
- [讨论点](calculus/memory/discussion-points.json)：6 组候选讨论主题，每组包含 3 个可追问问题、讲解方向及来源。

## C 语言

- [示例教材](c-language/textbooks/primer.md)：6 章原创材料，覆盖程序结构与类型、分支与循环、函数、数组与字符串、指针、结构体与文件；包含完整程序、输出和易错点。
- [示例题库](c-language/questions/questions.json)：12 道程序阅读题，编号 C001–C012，采用标准 C11。
- [记忆点](c-language/memory/learning-points.json)：12 个知识要点，编号 CK001–CK012，附常见误区及来源。
- [讨论点](c-language/memory/discussion-points.json)：6 组讨论主题，编号 CD001–CD006，每组含 3 个建议追问、讲解方向及来源。

教材采用 Markdown，数学公式使用 LaTeX，程序与输出使用带语言标记的代码块；题目、记忆点和讨论点采用 JSON。当前教材与记忆均为 AI 生成的示例内容，不对应指定教材，也不代表真实用户的学习记录或已经发生的对话。

## 题目格式

`questions.json` 包含课程名称 `course`、说明 `description` 和题目列表 `questions`。

每道题包含：

| 字段          | 含义           |
| ------------- | -------------- |
| `id`          | 稳定的题目编号 |
| `title`       | 题目名称       |
| `topic`       | 所属主题       |
| `difficulty`  | 难度           |
| `question`    | 题干           |
| `answer`      | 参考答案       |
| `explanation` | 讲解要点       |

题干、答案和讲解要点保留 Markdown 与 LaTeX 文本。C 语言程序使用 `c` 代码块，输出使用 `text` 代码块。界面如何展示答案和讲解，由特性规格确定。

## 记忆格式与来源

两份记忆文件均包含 `course`（课程）、`origin`（内容来源说明）和 `points`（条目列表）。每个条目使用稳定编号，并通过 `source.textbook` 引用教材章节，通过 `source.question_ids` 引用配套题目编号；教材路径相对于记忆文件所在目录。

- 记忆点：高等数学使用 K001–K012，C 语言使用 CK001–CK012；包含 `title`、`content` 和 `common_mistake`，分别记录标题、知识内容和常见误区。
- 讨论点：高等数学使用 D001–D006，C 语言使用 CD001–CD006；包含 `title`、`prompts` 和 `guidance`，分别记录主题、建议追问和讲解方向。

教材章节使用固定锚点供记忆条目引用。修改教材路径、章节锚点或题目编号时，应同步检查相关引用；来源材料发生变化时，也应重新核对提炼内容。

## 内容授权

仓库自编示例材料按 [MIT](../LICENSE) 分发，来源与适用范围见[开源声明](../NOTICE.md)。课程记忆是随内容发布的知识要点。教师自学习需要用到的交流记录、用户反馈和个人学习记忆属于个人数据，与课程源内容分别管理。后续引入外部教材或数据集时，需要分别记录来源和授权，不能直接沿用示例材料的授权声明。
