"use client";
import React from 'react';

interface AppNotificationsProps {
    notification: {
        message: string;
        type: 'success' | 'error';
    } | null;
}

const AppNotifications: React.FC<AppNotificationsProps> = ({ notification }) => {
    if (!notification) return null;

    return (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-lg shadow-2xl border border-slate-700 z-50 flex items-center animate-fade-in-up">
            <div className={`w-3 h-3 rounded-full mr-3 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="font-medium">{notification.message}</span>
        </div>
    );
};

export default AppNotifications;
