// ─────────────────────────────────────────────────────────────────────────────
// MODAL — Giriş noktası (barrel / re-export).
//
// Bu dosya artık iş mantığı içermez. Tüm mantık 3 alt modüle taşındı:
//
//   modal-dialog.js  → _showConfirm, _showPrompt, _showInfo
//   modal-lock.js    → _getLock, _setLock, _applyLockState, _buildLockedView
//   modal-core.js    → openModal, closeModal, initModal (+ tüm iç mantık)
//
// Dışarıdan bu dosyayı import eden HİÇBİR DOSYA DEĞİŞMEZ:
//   import { openModal }                   from "./ui/modal.js"   ✅ çalışır
//   import { _showConfirm, _showPrompt }   from "./ui/modal.js"   ✅ çalışır
//   import { initModal }                   from "./ui/modal.js"   ✅ çalışır
// ─────────────────────────────────────────────────────────────────────────────

export { openModal, closeModal, initModal } from "./modal-core.js";
export { _showConfirm, _showPrompt, _showInfo } from "./modal-dialog.js";