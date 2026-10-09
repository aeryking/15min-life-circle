/**
 * 百度地图 Web 服务 API 错误分类。
 * 状态码参考：https://lbsyun.baidu.com/faq/api?title=webapi/appendix
 */

export const ErrorKind = Object.freeze({
  TRANSIENT: 'transient', // 网络抖动 / 超时 / 服务端内部错误 → 退避重试
  RATE_LIMIT: 'rate_limit', // QPS 并发超限 → 降速 + 退避重试
  QUOTA: 'quota', // 日配额耗尽 → 熔断，走降级
  AUTH: 'auth', // AK 非法 / 未开通服务 / 白名单 → 熔断，走降级
  PARAM: 'param', // 参数非法 → 不重试
  NO_RESULT: 'no_result', // 正常返回但无结果
  UNAVAILABLE: 'unavailable', // 熔断中 / 回放缺失 / 未配置 AK
});

export class BaiduApiError extends Error {
  constructor(message, { kind, status, service, cause } = {}) {
    super(message, { cause });
    this.name = 'BaiduApiError';
    this.kind = kind || ErrorKind.TRANSIENT;
    this.status = status;
    this.service = service;
  }

  get retryable() {
    return this.kind === ErrorKind.TRANSIENT || this.kind === ErrorKind.RATE_LIMIT;
  }
}

/** 把百度返回的 status 映射为错误类别；0 表示成功返回 null */
export function classifyStatus(status) {
  const s = Number(status);
  if (s === 0) return null;
  if (s === 401 || s === 402) return ErrorKind.RATE_LIMIT;
  if (s === 4 || (s >= 300 && s < 400)) return ErrorKind.QUOTA;
  if (s === 3 || s === 5 || s === 101 || s === 102 || s === 240 || (s >= 200 && s < 300)) return ErrorKind.AUTH;
  if (s === 2) return ErrorKind.PARAM;
  if (s === 1) return ErrorKind.TRANSIENT;
  return ErrorKind.TRANSIENT;
}

export const kindLabel = {
  transient: '网络或服务端临时错误',
  rate_limit: 'QPS 并发超限',
  quota: '配额不足',
  auth: 'AK 校验失败或服务未开通',
  param: '请求参数非法',
  no_result: '无结果',
  unavailable: '服务不可用',
};
