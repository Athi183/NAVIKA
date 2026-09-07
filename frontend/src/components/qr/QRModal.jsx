import Modal from '../common/Modal'
import QRDisplay from './QRDisplay'

export default function QRModal({ isOpen, onClose, route }) {
  return (
    <Modal open={isOpen} onClose={onClose} title="Share Your NAVIKA Route">
      <div className="space-y-5 text-center">
        <div className="mx-auto flex justify-center">
          <QRDisplay value={route?.url || 'https://navika.demo/route'} />
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Scan this QR code</p>
          <p className="mt-2 text-sm text-slate-300">to continue your route on your phone.</p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left text-sm text-slate-300">
          <div className="flex justify-between gap-4">
            <span className="text-slate-400">From</span>
            <span>{route?.source || 'Main Entrance'}</span>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <span className="text-slate-400">To</span>
            <span>{route?.destination || 'CSE Department'}</span>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <span className="text-slate-400">Valid for</span>
            <span>{route?.validFor || '59:42'}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
