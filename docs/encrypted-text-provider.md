# 加密文本接入方案（候选，尚未完成安全验证）

加密文本通过 `EditorOptions.encryptedTextProvider` 接入宿主提供的加密服务。未配置 provider，或 provider 缺少 `encrypt`、`decrypt` 时，插入入口不可用；React、Vue、Solid 适配器提供同名属性，运行时可通过 `EditorController.setIntegrations` 更新。

```ts
import type { EncryptedTextProvider } from "@semlo-editor/core";

const provider: EncryptedTextProvider = {
  async encrypt({ plaintext, password, signal }) {
    // 接入经过审查的宿主加密实现；返回其可持久化的密文包字符串。
    return hostEncryption.encrypt({ plaintext, password, signal });
  },
  async decrypt({ ciphertext, password, signal }) {
    return hostEncryption.decrypt({ ciphertext, password, signal });
  },
};
```

示例中的 `hostEncryption` 是接入方负责实现的接口示意，不是项目提供的加密算法。provider 接收明文和密码，必须明确其运行位置、密钥管理和数据处理方式并经过安全审查；若服务端接收明文或密码，不能称为端到端加密或对宿主保密。任何同源脚本、具有页面权限的扩展或运行在该页面的宿主代码，都可能读取解锁后的界面与传给 provider 的明文。编辑器不能验证 provider 返回的数据是否加密，也不能保证清除 JavaScript 内存。

文档以 `semloEditorEncryptedText` 节点保存 provider 返回的非空字符串（上限 1,048,576 个 UTF-16 代码单元），JSON 和 HTML 中包含该字符串，纯文本中使用 `[加密文本]`。编辑器不解析密文包，算法、认证标签、随机数、盐、参数版本、有效性检查、迁移及兼容性由 provider 负责；格式损坏或版本未知时，provider 应拒绝解密而非降级为明文。与语雀数据格式和加密协议的互操作未验证。

初次输入和解锁编辑的明文驻留临时界面；provider 加密返回并满足目标仍有效后，编辑器才提交密文。异步失败保留界面草稿；提交前文档或目标发生变化时放弃写入并保留已有草稿；解锁请求返回前目标失效时不在界面显示迟到明文。关闭、销毁、卸载或切换编辑状态会清空并移除临时界面；这不保证任何运行时内存或其他观察者持有的副本被擦除。只读模式可解锁查看，不能提交修改。

历史记录、备份、协作服务、日志和此前存储过的普通明文由宿主负责。把先前已存的明文改为密文无法撤回已有副本；密码更换也无法让旧密文、历史记录或备份自动失效。密码恢复由宿主方案决定。provider 异常不会显示原始异常消息，避免错误信息意外泄露秘密。

当前仅用不具备保密性的模拟 provider 验证部分界面及数据路径，尚未证明真实密码学安全、跨浏览器和真实输入法表现，也未验证所有扩展、自定义节点、协作或系统剪贴板路径。接入前需针对具体 provider 和宿主进行密码学及安全评审。
