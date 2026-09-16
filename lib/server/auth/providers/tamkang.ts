import { ApiError } from "../../security";
import { tamkangConfigured, tamkangProtocol } from "../mode";

export const TamkangAuthProvider = {
  protocol: tamkangProtocol,
  isConfigured: tamkangConfigured,
  unavailableMessage() {
    return "淡江 SSO 尚未完成設定";
  },
  start() {
    if (!this.isConfigured())
      throw new ApiError(
        503,
        "AUTH_ERROR",
        this.unavailableMessage(),
        "AUTH_ERROR",
      );
    throw new ApiError(
      503,
      "AUTH_ERROR",
      "淡江正式 Identity Provider 已標記協定為 " +
        this.protocol() +
        "，但尚未完成校方 Client／Metadata 接入，不能假裝登入成功。",
      "AUTH_ERROR",
    );
  },
  callback() {
    return this.start();
  },
};
