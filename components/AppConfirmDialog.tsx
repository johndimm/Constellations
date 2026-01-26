import React from 'react';

interface AppConfirmDialogProps {
    confirmDialog: {
        isOpen: boolean;
        message: string;
        onConfirm: () => void;
    } | null;
    onClose: () => void;
}

const AppConfirmDialog: React.FC<AppConfirmDialogProps> = ({ confirmDialog, onClose }) => {
    if (!confirmDialog || !confirmDialog.isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center pb-20 sm:items-center sm:pb-0 px-4">
            <div
                className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm animate-fade-in"
                onClick={onClose}
            ></div>
            <div className="bg-slate-900 text-white px-6 py-5 rounded-2xl border border-slate-700 shadow-2xl max-w-sm w-full relative animate-scale-in">
                <h3 className="text-lg font-bold mb-2">Confirm Action</h3>
                <p className="text-sm text-slate-300 mb-6">{confirmDialog.message}</p>
                <div className="flex justify-end gap-3 text-sm">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-800 transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            confirmDialog.onConfirm();
                            onClose();
                        }}
                        className="px-6 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white transition-colors font-bold shadow-lg shadow-red-900/20"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AppConfirmDialog;
