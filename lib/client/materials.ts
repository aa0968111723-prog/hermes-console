export function materialImageSrc(
  id: string,
  variant: "full" | "thumb" = "thumb",
) {
  return (
    "/api/materials?id=" +
    encodeURIComponent(id) +
    (variant === "thumb" ? "&variant=thumb" : "")
  );
}
