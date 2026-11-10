/* Browser entry for the islands bundle (built by Vite into public/assets):
   registers the custom elements. */
import { register } from '@hyper-effect/island/client'

import { PageEditor } from '@/app/editor/island'
import { makePageEditor } from '@/app/editor/editor.client'

register(PageEditor, makePageEditor)
