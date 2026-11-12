class ConnectionError(Exception):
    def __init__(self, message, code="connection_failed", *, details=""):
        super().__init__(message)
        self.code = code
        # 供适配器识别原生错误；不将诊断详情直接作为网页提示或日志输出。
        self.details = details
