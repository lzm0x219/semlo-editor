/** 功能校验失败时保留具体错误，避免内容解析层依赖具体功能。 */
export class ContentValidationError extends Error {}
