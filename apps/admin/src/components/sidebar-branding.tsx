import React from 'react'

/**
 * Kenar çubuğu marka kilidi — AdminJS'in varsayılan SidebarBranding'ini override eder.
 *
 * Varsayılan bileşen "logo VARSA yalnızca logo, YOKSA şirket adı" mantığıyla çalışır
 * (ikisini birlikte göstermez). Biz hem ekler mark'ını hem de "ekler" sözcük markasını
 * yan yana basıyoruz. Stil: public/ekler-admin.css → .ekler-brand.
 *
 * Logoya tıklayınca panele (rootPath) döner; düz <a> = tam yenileme ama her durumda
 * doğru hedefe gider.
 */

/** rootPath, AdminJS tarafından SSR'da window.REDUX_STATE'e gömülür (statik değer). */
function rootPath(): string {
  const state = (globalThis as { REDUX_STATE?: { paths?: { rootPath?: string } } }).REDUX_STATE
  return state?.paths?.rootPath ?? '/admin'
}

const SidebarBranding: React.FC = () => (
  <a href={rootPath()} className="ekler-brand" data-css="sidebar-logo" aria-label="ekler">
    <img className="ekler-brand__mark" src="/public/ekler-mark-dark.png" alt="" />
    <span className="ekler-brand__word">ekler</span>
  </a>
)

export default SidebarBranding
