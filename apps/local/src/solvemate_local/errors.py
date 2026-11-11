class ConnectionError(Exception):
    def __init__(self, message, code="connection_failed"):
        super().__init__(message)
        self.code = code
