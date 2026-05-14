"use client";
import { useState, useEffect } from 'react';
import {
    KioskDomain,
    hasLocalKioskDomains,
    loadKioskDomains,
    saveKioskDomains,
    loadSelectedKioskDomainId,
    saveSelectedKioskDomainId
} from '../kioskDomains';

export function useKioskMode() {
    // Admin mode: enables editing kiosk domains in-app (requires keyboard/mouse)
    const [isAdminMode] = useState(() => {
        try {
            const params = new URLSearchParams(window.location.search);
            return params.get('admin') === '1';
        } catch {
            return false;
        }
    });

    const [kioskDomains, setKioskDomains] = useState<KioskDomain[]>(() => loadKioskDomains());
    const [selectedKioskDomainId, setSelectedKioskDomainId] = useState<string>(() =>
        loadSelectedKioskDomainId(loadKioskDomains())
    );

    useEffect(() => {
        // Persistence is currently disabled.
        // const persistEnabled = isAdminMode || hasLocalKioskDomains();
        // if (!persistEnabled) return;
        // try { saveKioskDomains(kioskDomains); } catch { }
        // try { saveSelectedKioskDomainId(selectedKioskDomainId); } catch { }
    }, [kioskDomains, selectedKioskDomainId, isAdminMode]);

    const selectedKioskDomain = kioskDomains.find(d => d.id === selectedKioskDomainId) || kioskDomains[0];
    const kioskSeedTerms = selectedKioskDomain?.terms || [];

    return {
        isAdminMode,
        kioskDomains,
        setKioskDomains,
        selectedKioskDomainId,
        setSelectedKioskDomainId,
        selectedKioskDomain,
        kioskSeedTerms
    };
}
