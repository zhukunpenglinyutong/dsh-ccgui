# Third-party notices

## DeepSeek Harness

`src/stdio-transport.ts` adapts the process teardown ladder and ACP wiring from
`packages/subagent/subagent-acp/src/run.ts` in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Product marks

`src/client/marks.tsx` draws other projects' marks so a person can tell the CLIs apart, and
a model's maker apart in a CLI's model list. The names and marks belong to their owners, are
not covered by this project's MIT license, and imply no endorsement. A model whose maker is
not public (for example an anonymous launch such as Space-Bunny) gets a neutral question-mark
glyph drawn by this project, never another party's logo.
- Xiaomi MiMo: lobe-icons ships only a wordmark, which is unreadable at the 14px the model
  menu uses. The orange monogram tile in `marks.tsx` is drawn by this project; no third-party
  path is used for it.

- OMP: the mark from [omp.sh](https://omp.sh). No license for it has been confirmed.
- Claude: [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) call for
  written permission to use its logo beyond naming Claude Code in plain text. No such
  permission has been confirmed. The license below covers only the SVG path.
- OpenAI (shown for Codex), Claude, Pi, OpenCode, CodeBuddy, Kimi, DeepSeek, Hunyuan, Zhipu,
  MiniMax and StepFun: the SVG paths from
  [lobe-icons](https://github.com/lobehub/lobe-icons) v6.15.0, under this license:

MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
