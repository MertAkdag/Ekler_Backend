import { ComponentLoader } from 'adminjs'

/** Custom frontend components, bundled by AdminJS (admin.watch() in dev). */
export const componentLoader = new ComponentLoader()

export const Components = {
  Dashboard: componentLoader.add('Dashboard', './components/dashboard'),
}
