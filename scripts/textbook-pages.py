"""读取发布用 PDF 的逐页文字；使用本机服务已有的 pypdf 依赖。"""

import json
import sys
import unicodedata

from pypdf import PdfReader

reader = PdfReader(sys.argv[1])
print(
    json.dumps(
        [
            unicodedata.normalize("NFKC", page.extract_text() or "")
            for page in reader.pages
        ],
        ensure_ascii=True,
    )
)
