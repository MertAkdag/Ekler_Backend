import { ComponentLoader } from 'adminjs'

/** Custom frontend components, bundled by AdminJS (admin.watch() in dev). */
export const componentLoader = new ComponentLoader()

export const Components = {
  Dashboard: componentLoader.add('Dashboard', './components/dashboard'),
  StatusBadge: componentLoader.add('StatusBadge', './components/status-badge'),
  Thumbnail: componentLoader.add('Thumbnail', './components/thumbnail'),
  Hub: componentLoader.add('Hub', './components/hub'),
  RecordShow: componentLoader.add('RecordShow', './components/record-show'),
  SanctionForm: componentLoader.add('SanctionForm', './components/sanction-form'),
}
