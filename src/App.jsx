import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Camera, Settings as SettingsIcon, Sparkles, Folder, LogIn, FileText, TrendingUp, MapPin, Check, Trash2, X, ChevronDown, CloudLightning } from 'lucide-react';
import StagingCard from './components/StagingCard';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { useInvoiceSync } from './hooks/useInvoiceSync';
import { useInviteGate } from './hooks/useInviteGate';
import { useProjects } from './hooks/useProjects';
import { useStagedDocuments } from './hooks/useStagedDocuments';
import { loadCachedKnownSubs } from './services/payeeMatching';
import ToastNotification from './components/ToastNotification';
import DashboardErrorBoundary from './components/DashboardErrorBoundary';

function lazyWithRetry(componentImport) {
  return lazy(async () => {
    const hasReloaded = sessionStorage.getItem('sitetactix_chunk_reload');
    try {
      const module = await componentImport();
      if (!module || typeof module !== 'object' || !('default' in module) || !module.default) {
        throw new Error('Module has no default export or chunk is stale');
      }
      sessionStorage.removeItem('sitetactix_chunk_reload');
      return module;
    } catch (error) {
      if (!hasReloaded) {
        sessionStorage.setItem('sitetactix_chunk_reload', '1');
        console.warn('[SiteTactix] Stale deployment chunk detected, refreshing page...', error);
        window.location.reload();
        return new Promise(() => {});
      }
      throw error;
    }
  });
}

const Scanner = lazyWithRetry(() => import('./components/Scanner'));
const EditForm = lazyWithRetry(() => import('./components/EditForm'));
const Settings = lazyWithRetry(() => import('./components/Settings'));
const InviteScreen = lazyWithRetry(() => import('./components/InviteScreen'));
const Dashboard = lazyWithRetry(() => import('./components/Dashboard'));
const BlueprintPinboard = lazyWithRetry(() => import('./components/BlueprintPinboard'));

function LazyScreenFallback() {
  return (
    <div className="settings-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '220px' }}>
      <div className="spinner" />
    </div>
  );
}

export default function App() {
  // App Navigation & UI State
  const [activeTab, setActiveTab] = useState('invoices');
  const [invoicesSubTab, setInvoicesSubTab] = useState('scan'); // 'scan', 'staged', or 'history'
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  // Top bar slides away while scrolling down and comes back when scrolling up
  const [headerHidden, setHeaderHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 80) setHeaderHidden(false);
      else if (y - lastY > 6) setHeaderHidden(true);
      else if (lastY - y > 6) setHeaderHidden(false);
      if (Math.abs(y - lastY) > 6) lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const {
    isInvited,
    isAuthChecking,
    unlockInvite,
    resetInvite
  } = useInviteGate();
  const {
    googleToken,
    googleUser,
    signingIn,
    signIn: handleGoogleSignIn,
    signOut: googleSignOut,
    reconnectGoogleDrive,
    handleSessionExpired,
    requestDriveAccessToken,
    googleStatus
  } = useGoogleAuth({
    setError,
    setSuccess,
    onSignedOut: () => {
      resetInvite();
    }
  });
  const {
    selectedFolder,
    setSelectedFolder,
    projects,
    activeProject,
    setActiveProject,
    updateProjects: handleUpdateProjects,
    selectActiveProject: handleSelectActiveProject,
    resetProjectSelection,
    sheetChoice,
    chooseSheetForProject,
    dismissSheetChoice
  } = useProjects({
    googleToken,
    googleUser,
    setSuccess
  });
  const {
    stagedItems,
    animateBadge,
    editingItemId,
    setEditingItemId,
    draftToDelete,
    setDraftToDelete,
    handleDataExtracted,
    handleSaveStagedEdits,
    handleDeleteStaged,
    confirmDeleteDraft,
    handleAdjustTimer,
    handleResetTimer,
    handleUpdateDraftField,
    updateStagedItem,
    removeStagedItem,
    removeStagedItems
  } = useStagedDocuments({
    activeProject,
    googleToken,
    setError,
    setSuccess
  });
  const {
    uploading,
    uploadStatusText,
    history,
    handleOneShotSync,
    handleSyncAllDrafts,
    handleViewPDF,
    handleClearHistory,
    handleDeleteHistoryItem
  } = useInvoiceSync({
    activeProject,
    googleToken,
    selectedFolder,
    projects,
    stagedItems,
    removeStagedItem,
    removeStagedItems,
    updateStagedItem,
    handleSessionExpired,
    setError,
    setSuccess
  });

  const handleSignOut = () => {
    googleSignOut();
    resetProjectSelection();
  };

  // Close project dropdown when clicking outside
  useEffect(() => {
    if (!showProjectDropdown) return;

    const handleOutsideClick = (e) => {
      const headerSection = document.querySelector('.header-project-section');
      if (headerSection && !headerSection.contains(e.target)) {
        setShowProjectDropdown(false);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('click', handleOutsideClick);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [showProjectDropdown]);

  if (isAuthChecking) {
    return <LazyScreenFallback />;
  }

  if (!isInvited) {
    return (
      <Suspense fallback={<LazyScreenFallback />}>
        <InviteScreen
          onUnlocked={unlockInvite}
          googleUser={googleUser}
          authError={error}
          signingIn={signingIn}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
        />
      </Suspense>
    );
  }

  return (
    <div className="studio-shell">
      {/* Studio Desktop Sidebar (>= 1024px) */}
      <aside className="studio-sidebar">
        <div className="studio-sidebar-brand">
          <svg 
            className="studio-sidebar-stacked-logo" 
            viewBox="0 24 200 160" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg" 
            aria-label="ADEPEC HOMES"
          >
            <defs>
              <linearGradient id="sidebar-sandstone-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C8B69A"/>
                <stop offset="50%" stopColor="#E8DEC8"/>
                <stop offset="100%" stopColor="#A8967D"/>
              </linearGradient>
            </defs>
            {/* 1. Champagne Sandstone House Symbol */}
            <g transform="translate(50, 24) scale(1)">
              <path d="M50 15 L80 45 V85 H71 V45 L50 24 L29 45 V85 H20 V45 Z" fill="url(#sidebar-sandstone-grad)"/>
              <path fillRule="evenodd" d="M50 33.5 L66.5 50 V85 H50.5 V73 H49.5 V85 H33.5 V50 Z M50 42.5 L57.5 50 V63 H42.5 V50 Z" fill="url(#sidebar-sandstone-grad)"/>
            </g>
            {/* 2. Official Vector ADEPEC Glyphs */}
            <g fill="#FFFFFF">
              <path d="M382.99908447265625 709.0000610351562 625.3991088867188 84Q639.59912109375 49.199951171875 656.1991577148438 35.0999755859375Q672.7991943359375 21 686.3992309570312 20V0Q653.5994262695312 2 609.399658203125 2.5Q565.1998901367188 3 519.400146484375 3Q470.80029296875 3 428.00042724609375 2.5Q385.2005615234375 2 359.400634765625 0V20Q410.400634765625 22 424.0006408691406 37.5Q437.60064697265625 53 417.60064697265625 104L252.40032958984375 557.8006591796875L271.60028076171875 588.400390625L126.39984130859375 210.79925537109375Q103.199951171875 150.799560546875 98.19998168945312 113.69970703125Q93.20001220703125 76.599853515625 102.89999389648438 56.59991455078125Q112.5999755859375 36.5999755859375 134.29995727539062 28.79998779296875Q155.99993896484375 21 186.199951171875 20V0Q151.00006103515625 2 121.300048828125 2.5Q91.60003662109375 3 58.400146484375 3Q38.2000732421875 3 17.5001220703125 2.5Q-3.1998291015625 2 -18.1998291015625 0V20Q4.20013427734375 24.20001220703125 26.400115966796875 48.2999267578125Q48.60009765625 72.39984130859375 71.20001220703125 130.9996337890625L295.8001708984375 709.0000610351562Q315.7999267578125 707.4000854492188 339.3996276855469 707.4000854492188Q362.99932861328125 707.4000854492188 382.99908447265625 709.0000610351562ZM435.400146484375 288V268H137.400146484375L147.400146484375 288Z" transform="translate(56.5342,145.0000) scale(0.02100000,-0.02100000)"/>
              <path d="M351.7994384765625 708Q555.5990600585938 708 654.1988830566406 618.5Q752.7987060546875 529 752.7987060546875 362Q752.7987060546875 253 704.2987976074219 171.5Q655.7988891601562 90 563.9990539550781 45.0Q472.19921875 0 342.7994384765625 0Q326.99945068359375 0 300.7994689941406 1.0Q274.5994873046875 2 246.09951782226562 2.5Q217.59954833984375 3 194.799560546875 3Q147.79974365234375 3 102.99990844726562 2.5Q58.2000732421875 2 30.8001708984375 0V20Q62.40020751953125 22 77.90023803710938 28.0Q93.4002685546875 34 98.60028076171875 52.0Q103.80029296875 70 103.80029296875 106V602Q103.80029296875 639 98.60028076171875 656.5Q93.4002685546875 674 77.500244140625 680.5Q61.6002197265625 687 30.8001708984375 688V708Q58.2000732421875 707 102.99990844726562 705.5Q147.79974365234375 704 192.799560546875 705Q229.3995361328125 706 275.3995056152344 707.0Q321.39947509765625 708 351.7994384765625 708ZM358.7989501953125 690Q312.7989501953125 690 298.7989501953125 673.0Q284.7989501953125 656 284.7989501953125 604V104Q284.7989501953125 52 299.2989501953125 35.0Q313.7989501953125 18 359.7989501953125 18Q435.99945068359375 18 480.7996826171875 57.5Q525.5999145507812 97 545.1999816894531 173.0Q564.800048828125 249 564.800048828125 358Q564.800048828125 470 543.8999633789062 543.5Q522.9998779296875 617 477.69964599609375 653.5Q432.3994140625 690 358.7989501953125 690Z" transform="translate(70.8671,145.0000) scale(0.02100000,-0.02100000)"/>
              <path d="M577.7994384765625 708Q573.7994384765625 661.0001831054688 572.2994384765625 617.2003479003906Q570.7994384765625 573.4005126953125 570.7994384765625 550.0006103515625Q570.7994384765625 529.6780651461694 571.7994384765625 511.04906537455895Q572.7994384765625 492.42006560294857 573.7994384765625 480.000732421875H550.7994384765625Q539.99951171875 558.200439453125 515.3997192382812 603.1002807617188Q490.7999267578125 648.0001220703125 455.50006103515625 666.5000610351562Q420.2001953125 685 376.800048828125 685H349.7991943359375Q322.50054135529894 685 308.4497640858526 680.2999877929688Q294.39898681640625 675.5999755859375 289.5989685058594 661.5999221801758Q284.7989501953125 647.5998687744141 284.7989501953125 617.999755859375V90.000244140625Q284.7989501953125 61.20013427734375 289.5989685058594 46.800079345703125Q294.39898681640625 32.4000244140625 308.4497640858526 27.70001220703125Q322.50054135529894 23 349.7991943359375 23H390.7996826171875Q429.800048828125 23 465.5 43.599945068359375Q501.199951171875 64.19989013671875 528.8997497558594 113.49972534179688Q556.5995483398438 162.799560546875 570.7994384765625 247.999267578125H593.7994384765625Q590.7994384765625 213.79937744140625 590.7994384765625 159.99951171875Q590.7994384765625 136.27069498697915 591.8994445800781 91.93527425130208Q592.9994506835938 47.599853515625 597.7994384765625 0Q546.7994384765625 2 482.7994384765625 2.5Q418.7994384765625 3 368.7994384765625 3Q343.11253821331525 3 302.8308082550411 3.0Q262.54907829676694 3 215.84562327268097 2.5Q169.142168248595 2 121.27112684890687 1.5Q73.40008544921875 1 30.8001708984375 0V20Q62.40020751953125 22 77.815132952751 28.0Q93.23005838597075 34 98.51517567736038 52.0Q103.80029296875 70 103.80029296875 106V602Q103.80029296875 639 98.41304957613032 656.5Q93.02580618351064 674 77.31301295503657 680.5Q61.6002197265625 687 30.8001708984375 688V708Q73.76982770647321 707 121.38485281808036 706.5Q168.9998779296875 706 215.73661723889802 705.5Q262.47335654810854 705 302.7837942023026 705.0Q343.0942318564967 705 368.7994384765625 705Q414.7994384765625 705 473.2994384765625 705.5Q531.7994384765625 706 577.7994384765625 708ZM427.39910888671875 366Q427.39910888671875 366 427.39910888671875 356.0Q427.39910888671875 346 427.39910888671875 346H254.7989501953125Q254.7989501953125 346 254.7989501953125 356.0Q254.7989501953125 366 254.7989501953125 366ZM456.39910888671875 498Q452.39910888671875 441 452.89910888671875 411.0Q453.39910888671875 381 453.39910888671875 356Q453.39910888671875 331 454.39910888671875 301.0Q455.39910888671875 271 459.39910888671875 214H436.39910888671875Q430.79913330078125 249.99993896484375 414.8992919921875 280.0999450683594Q398.99945068359375 310.199951171875 372.0995788574219 328.0999755859375Q345.19970703125 346 305.9996337890625 346V366Q334.99969482421875 366 356.8996276855469 378.3000183105469Q378.799560546875 390.60003662109375 394.3994445800781 410.800048828125Q409.99932861328125 431.00006103515625 419.7992248535156 453.9000549316406Q429.59912109375 476.800048828125 433.39910888671875 498Z" transform="translate(87.5730,145.0000) scale(0.02100000,-0.02100000)"/>
              <path d="M30.8001708984375 708Q58.2000732421875 707 102.99990844726562 706.0Q147.79974365234375 705 192.799560546875 705Q242.19952392578125 705 287.5994873046875 706.0Q332.99945068359375 707 351.7994384765625 707Q497.59906005859375 707 569.1988830566406 652.0Q640.7987060546875 597 640.7987060546875 510Q640.7987060546875 474 626.3987426757812 434.5Q611.998779296875 395 577.2988586425781 361.5Q542.5989379882812 328 482.3990783691406 307.0Q422.19921875 286 329.7994384765625 286H225.799560546875V306H319.7994384765625Q374.7996826171875 306 403.49981689453125 333.0Q432.199951171875 360 442.5 404.0Q452.800048828125 448 452.800048828125 499Q452.800048828125 594 428.099853515625 641.0Q403.399658203125 688 342.7991943359375 688Q306.3990478515625 688 295.5989990234375 671.0Q284.7989501953125 654 284.7989501953125 602V113.9998779296875Q284.7989501953125 73.99993896484375 293.09893798828125 54.39996337890625Q301.39892578125 34.79998779296875 324.9989013671875 28.79998779296875Q348.598876953125 22.79998779296875 393.798828125 22.39996337890625V0Q361.39892578125 1.20001220703125 309.39910888671875 2.100006103515625Q257.3992919921875 3 199.59954833984375 3Q154.9996337890625 3 111.3997802734375 2.100006103515625Q67.7999267578125 1.20001220703125 30.8001708984375 0V20Q62.40020751953125 22 77.90023803710938 28.0Q93.4002685546875 34 98.60028076171875 52.0Q103.80029296875 70 103.80029296875 106V602Q103.80029296875 639 98.60028076171875 656.5Q93.4002685546875 674 77.500244140625 680.5Q61.6002197265625 687 30.8001708984375 688V708Q58.2000732421875 707 102.99990844726562 705.5Q147.79974365234375 704 192.799560546875 705Q229.3995361328125 706 275.3995056152344 707.0Q321.39947509765625 708 351.7994384765625 708Z" transform="translate(101.1080,145.0000) scale(0.02100000,-0.02100000)"/>
              <path d="M577.7994384765625 708Q573.7994384765625 661.0001831054688 572.2994384765625 617.2003479003906Q570.7994384765625 573.4005126953125 570.7994384765625 550.0006103515625Q570.7994384765625 529.6780651461694 571.7994384765625 511.04906537455895Q572.7994384765625 492.42006560294857 573.7994384765625 480.000732421875H550.7994384765625Q539.99951171875 558.200439453125 515.3997192382812 603.1002807617188Q490.7999267578125 648.0001220703125 455.50006103515625 666.5000610351562Q420.2001953125 685 376.800048828125 685H349.7991943359375Q322.50054135529894 685 308.4497640858526 680.2999877929688Q294.39898681640625 675.5999755859375 289.5989685058594 661.5999221801758Q284.7989501953125 647.5998687744141 284.7989501953125 617.999755859375V90.000244140625Q284.7989501953125 61.20013427734375 289.5989685058594 46.800079345703125Q294.39898681640625 32.4000244140625 308.4497640858526 27.70001220703125Q322.50054135529894 23 349.7991943359375 23H390.7996826171875Q429.800048828125 23 465.5 43.599945068359375Q501.199951171875 64.19989013671875 528.8997497558594 113.49972534179688Q556.5995483398438 162.799560546875 570.7994384765625 247.999267578125H593.7994384765625Q590.7994384765625 213.79937744140625 590.7994384765625 159.99951171875Q590.7994384765625 136.27069498697915 591.8994445800781 91.93527425130208Q592.9994506835938 47.599853515625 597.7994384765625 0Q546.7994384765625 2 482.7994384765625 2.5Q418.7994384765625 3 368.7994384765625 3Q343.11253821331525 3 302.8308082550411 3.0Q262.54907829676694 3 215.84562327268097 2.5Q169.142168248595 2 121.27112684890687 1.5Q73.40008544921875 1 30.8001708984375 0V20Q62.40020751953125 22 77.815132952751 28.0Q93.23005838597075 34 98.51517567736038 52.0Q103.80029296875 70 103.80029296875 106V602Q103.80029296875 639 98.41304957613032 656.5Q93.02580618351064 674 77.31301295503657 680.5Q61.6002197265625 687 30.8001708984375 688V708Q73.76982770647321 707 121.38485281808036 706.5Q168.9998779296875 706 215.73661723889802 705.5Q262.47335654810854 705 302.7837942023026 705.0Q343.0942318564967 705 368.7994384765625 705Q414.7994384765625 705 473.2994384765625 705.5Q531.7994384765625 706 577.7994384765625 708ZM427.39910888671875 366Q427.39910888671875 366 427.39910888671875 356.0Q427.39910888671875 346 427.39910888671875 346H254.7989501953125Q254.7989501953125 346 254.7989501953125 356.0Q254.7989501953125 366 254.7989501953125 366ZM456.39910888671875 498Q452.39910888671875 441 452.89910888671875 411.0Q453.39910888671875 381 453.39910888671875 356Q453.39910888671875 331 454.39910888671875 301.0Q455.39910888671875 271 459.39910888671875 214H436.39910888671875Q430.79913330078125 249.99993896484375 414.8992919921875 280.0999450683594Q398.99945068359375 310.199951171875 372.0995788574219 328.0999755859375Q345.19970703125 346 305.9996337890625 346V366Q334.99969482421875 366 356.8996276855469 378.3000183105469Q378.799560546875 390.60003662109375 394.3994445800781 410.800048828125Q409.99932861328125 431.00006103515625 419.7992248535156 453.9000549316406Q429.59912109375 476.800048828125 433.39910888671875 498Z" transform="translate(114.9999,145.0000) scale(0.02100000,-0.02100000)"/>
              <path d="M405.39947509765625 722Q471.39947509765625 722 513.8994750976562 702.5Q556.3994750976562 683 589.3994750976562 657Q609.3994750976562 642 619.8994750976562 653.5Q630.3994750976562 665 634.3994750976562 708H657.3994750976562Q655.3994750976562 668.6000366210938 654.3994750976562 612.0000915527344Q653.3994750976562 555.400146484375 653.3994750976562 462.000244140625H630.3994750976562Q625.7994384765625 509.00018310546875 617.3994750976562 544.1000366210938Q608.99951171875 579.1998901367188 592.8996276855469 605.999755859375Q576.7997436523438 632.7996215820312 546.7999877929688 653.9995727539062Q523.7998657226562 673.39990234375 495.5995788574219 683.5000305175781Q467.3992919921875 693.6001586914062 436.99896240234375 693.6001586914062Q381.59906005859375 693.6001586914062 344.0990295410156 663.500244140625Q306.5989990234375 633.4003295898438 284.4989013671875 583.8003845214844Q262.3988037109375 534.200439453125 252.89871215820312 473.6003723144531Q243.39862060546875 413.00030517578125 243.39862060546875 352Q243.39862060546875 290.399658203125 253.19873046875 229.89959716796875Q262.99884033203125 169.3995361328125 285.49896240234375 120.19961547851562Q307.99908447265625 70.99969482421875 345.8991394042969 41.2998046875Q383.7991943359375 11.59991455078125 438.99908447265625 11.59991455078125Q467.99932861328125 11.59991455078125 496.5996398925781 22.000030517578125Q525.199951171875 32.400146484375 547.6000366210938 50.80047607421875Q591.9996948242188 81.40045166015625 607.6995849609375 129.80023193359375Q623.3994750976562 178.20001220703125 630.3994750976562 255.999755859375H653.3994750976562Q653.3994750976562 159.39984130859375 654.3994750976562 99.89990234375Q655.3994750976562 40.39996337890625 657.3994750976562 0H634.3994750976562Q630.3994750976562 43 620.8994750976562 54.0Q611.3994750976562 65 589.3994750976562 51Q552.3994750976562 25 510.89947509765625 5.5Q469.39947509765625 -14 404.39947509765625 -14Q294.99969482421875 -14 212.69985961914062 29.0Q130.4000244140625 72 84.90011596679688 153.0Q39.40020751953125 234 39.40020751953125 348Q39.40020751953125 460 86.40011596679688 544.0Q133.4000244140625 628 215.69985961914062 675.0Q297.99969482421875 722 405.39947509765625 722Z" transform="translate(128.5348,145.0000) scale(0.02100000,-0.02100000)"/>
            </g>
            {/* 3. HOMES in Syne with symmetrical gold flank lines */}
            <text x="100" y="172" textAnchor="middle" style={{ fontFamily: "var(--font-syne, 'Syne', sans-serif)", fontWeight: 700, fontSize: '10px', letterSpacing: '0.28em', textTransform: 'uppercase', fill: '#FFFFFF' }}>HOMES</text>
            <line x1="22" y1="168" x2="61" y2="168" stroke="#C8B69A" strokeWidth="1.5"/>
            <line x1="135" y1="168" x2="174" y2="168" stroke="#C8B69A" strokeWidth="1.5"/>
          </svg>
          <div className="studio-brand-badge">SiteTactix</div>
        </div>

        <div 
          className="studio-active-project-card"
          onClick={() => setShowProjectDropdown(prev => !prev)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowProjectDropdown(prev => !prev);
            }
          }}
          title="Click to switch active project"
        >
          <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--st-muted)', marginBottom: '3px' }}>
            Active Project
          </div>
          <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--st-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeProject ? activeProject.name : 'Select Project'}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--st-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedFolder ? selectedFolder.name : 'No folder set'}
          </div>
        </div>

        <nav className="studio-nav">
          <button 
            type="button"
            className={`studio-nav-item ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => setActiveTab('invoices')}
          >
            <FileText size={18} />
            <span>Invoices</span>
            {stagedItems.length > 0 && (
              <span className="studio-nav-badge">{stagedItems.length}</span>
            )}
          </button>
          <button 
            type="button"
            className={`studio-nav-item ${activeTab === 'xray' ? 'active' : ''}`}
            onClick={() => setActiveTab('xray')}
          >
            <MapPin size={18} />
            <span>X-Ray</span>
          </button>
          <button 
            type="button"
            className={`studio-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <TrendingUp size={18} />
            <span>Dashboard</span>
          </button>
          <button 
            type="button"
            className={`studio-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <SettingsIcon size={18} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="studio-sidebar-footer">
          <div className="studio-user-card">
            <div className="studio-avatar">AH</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--st-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Adepec Homes
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--st-muted)' }}>
                Austin, TX
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main App Workspace */}
      <div className="app-main">
        <ToastNotification
          message={success || error}
          type={success ? 'success' : 'error'}
          onClose={() => { setSuccess(null); setError(null); }}
        />
        {/* 1. Header */}
        <header className={`app-header${headerHidden && !showProjectDropdown ? ' app-header--hidden' : ''}`}>
          <div className="executive-command-island">
            {/* Left: Refined ADEPEC Brand Monogram */}
            <div className="command-island-brand">
              <div className="command-brand-icon">
                <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '18px', height: '18px' }} aria-hidden="true">
                  <defs>
                    <linearGradient id="island-sandstone" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#C8B69A" />
                      <stop offset="50%" stopColor="#E8DEC8" />
                      <stop offset="100%" stopColor="#A8967D" />
                    </linearGradient>
                  </defs>
                  <path d="M50 15 L80 45 V85 H71 V45 L50 24 L29 45 V85 H20 V45 Z" fill="url(#island-sandstone)" />
                  <path fillRule="evenodd" d="M50 33.5 L66.5 50 V85 H50.5 V73 H49.5 V85 H33.5 V50 Z M50 42.5 L57.5 50 V63 H42.5 V50 Z" fill="url(#island-sandstone)" />
                </svg>
              </div>
              <div className="command-brand-text">
                <span className="command-brand-title">ADEPEC</span>
                <span className="command-brand-sub">SITETACTIX</span>
              </div>
            </div>

            {/* Right: Drive connection dot and the Lot picker */}
            <div className="command-actions-cluster">
              {googleStatus === 'connected' && (
                <div
                  className="command-sync-dot"
                  title="Google Drive connected"
                />
              )}
              {googleStatus === 'needs_signin' && (
                <button
                  type="button"
                  className="command-sync-dot command-sync-dot--expired"
                  title="Google sign-in expired. Tap to reconnect."
                  aria-label="Google sign-in expired. Tap to reconnect."
                  onClick={() => reconnectGoogleDrive()}
                />
              )}
              <div 
                className="command-project-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowProjectDropdown(!showProjectDropdown);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setShowProjectDropdown(!showProjectDropdown);
                  }
                }}
                title="Switch Active Project"
              >
                <span className="command-project-indicator" />
                <span className="command-project-name">
                  {activeProject ? activeProject.name : 'Select Project'}
                </span>
                <ChevronDown size={12} className="command-project-caret" />
              </div>
            </div>

            {/* Project Dropdown Menu */}
            {showProjectDropdown && (
              <div
                className="command-dropdown-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="command-dropdown-header">
                  <span>Select Project</span>
                </div>
                <div className="command-dropdown-list">
                  {projects.length === 0 ? (
                    <div className="command-dropdown-empty">
                      No saved projects.
                    </div>
                  ) : (
                    projects.map(proj => {
                      const isActive = activeProject && activeProject.id === proj.id;
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectActiveProject(proj.id);
                            setShowProjectDropdown(false);
                          }}
                          className={`command-dropdown-item ${isActive ? 'active' : ''}`}
                        >
                          <span className="command-dropdown-item-name">{proj.name}</span>
                          {isActive && <Check size={14} style={{ color: 'var(--st-gold)', flexShrink: 0 }} />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </header>



      {/* 2. Main Content */}
      <main className="app-content">

        {/* Tab view routing */}
        <Suspense fallback={<LazyScreenFallback />}>
        {editingItemId && stagedItems.find(item => item.id === editingItemId) ? (
          <EditForm 
            stagedItem={stagedItems.find(item => item.id === editingItemId)}
            onSave={handleSaveStagedEdits}
            onCancel={() => setEditingItemId(null)}
            history={history}
            stagedItems={stagedItems}
            projects={projects}
            knownSubs={loadCachedKnownSubs(localStorage, activeProject?.spreadsheetId)}
          />
        ) : activeTab === 'invoices' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Sliding Pill Selector Segmented Control */}
            <div className="sliding-toggle-container">
              <div className={`sliding-toggle-active-bg ${invoicesSubTab === 'scan' ? 'pos-0' : invoicesSubTab === 'staged' ? 'pos-1' : 'pos-2'}`} />
              <button 
                type="button"
                className={`sliding-toggle-btn ${invoicesSubTab === 'scan' ? 'active' : ''}`}
                onClick={() => setInvoicesSubTab('scan')}
              >
                <Camera size={14} />
                <span>Scan</span>
              </button>
              <button 
                type="button"
                className={`sliding-toggle-btn ${invoicesSubTab === 'staged' ? 'active' : ''}`}
                onClick={() => setInvoicesSubTab('staged')}
              >
                Drafts ({stagedItems.length})
              </button>
              <button 
                type="button"
                className={`sliding-toggle-btn ${invoicesSubTab === 'history' ? 'active' : ''}`}
                onClick={() => setInvoicesSubTab('history')}
              >
                History ({history.length})
              </button>
            </div>

            {/* Sliding Sub Tab Panels */}
            {invoicesSubTab === 'scan' ? (
              <div key="scan-subtab" className="slide-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <Scanner 
                  onDataExtracted={(data) => {
                    handleDataExtracted(data);
                    setInvoicesSubTab('staged');
                  }}
                  onError={setError}
                />

                {/* Google Drive Sign In / Reconnect Banner if not signed in */}
                {!googleToken && (
                  <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid var(--color-zinc-800)' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <Folder size={20} style={{ color: 'var(--color-amber-500)', marginTop: '2px', flex: 'none' }} />
                      <div>
                        <h4 style={{ fontWeight: 600, color: 'var(--color-zinc-200)' }}>
                          {googleUser ? 'Reconnect Google Drive' : 'Connect Google Drive'}
                        </h4>
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)', lineHeight: '1.4', marginTop: '2px' }}>
                          {googleUser
                            ? 'Your Google Drive authorization expired. Tap Reconnect to resume saving invoices and syncing budget spreadsheets.'
                            : 'Sign in to save PDFs directly to your Google Drive and log expense items into a Google Sheet automatically.'}
                        </p>
                      </div>
                    </div>
                    <button onClick={reconnectGoogleDrive || handleGoogleSignIn} className="btn btn-secondary" style={{ backgroundColor: '#fff', color: '#18181b', fontWeight: 700 }}>
                      <LogIn size={16} /> {googleUser ? 'Reconnect Google Drive' : 'Sign In with Google'}
                    </button>
                  </div>
                )}

                {/* No Projects Setup Warning */}
                {projects.length === 0 && (
                  <div className="settings-card" style={{ 
                    display: 'flex', 
                    gap: '12px', 
                    alignItems: 'flex-start',
                    border: '1px solid rgba(241, 215, 167, 0.25)',
                    backgroundColor: 'rgba(241, 215, 167, 0.04)',
                    borderLeft: '4px solid var(--color-amber-500)'
                  }}>
                    <Sparkles size={20} style={{ color: 'var(--color-amber-500)', marginTop: '2px', flex: 'none' }} />
                    <div>
                      <h4 style={{ fontWeight: 700, color: 'var(--color-zinc-100)', fontSize: '0.88rem' }}>No Active Project Profiles</h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-400)', lineHeight: '1.4', marginTop: '3px' }}>
                        You don't have any projects set up. Please go to your **Settings** tab to create your first project.
                      </p>
                      <button 
                        onClick={() => setActiveTab('settings')} 
                        className="btn btn-secondary" 
                        style={{ width: 'auto', padding: '6px 12px', fontSize: '0.78rem', marginTop: '8px', borderColor: 'var(--color-amber-500)', color: 'var(--color-amber-400)' }}
                      >
                        Go to Settings
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : invoicesSubTab === 'staged' ? (
              <div key="staged-subtab" className="slide-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {(() => {
                  const activeProjectDrafts = stagedItems.filter(item => {
                    const lot = (item.metadata?.lotNumber || '').trim().toLowerCase();
                    const projName = (activeProject?.name || '').trim().toLowerCase();
                    return !lot || lot === projName;
                  });
                  const activeProjectDraftsCount = activeProjectDrafts.length;

                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Staged Drafts ({stagedItems.length})</h2>
                        {stagedItems.length > 0 && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-zinc-500)', fontStyle: 'italic' }}>
                            Saved locally on device
                          </span>
                        )}
                      </div>
                      {stagedItems.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSyncAllDrafts}
                          disabled={uploading !== null || activeProjectDraftsCount === 0}
                          className="btn btn-primary"
                          style={{
                            width: 'auto',
                            padding: '6px 14px',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: 'var(--color-amber-500)',
                            color: '#18181b',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: (uploading !== null || activeProjectDraftsCount === 0) ? 'not-allowed' : 'pointer',
                            opacity: (uploading !== null || activeProjectDraftsCount === 0) ? 0.6 : 1
                          }}
                        >
                          {uploading === 'all' ? (
                            <>
                              <div className="spinner" style={{ width: '12px', height: '12px', borderWidth: '1.5px', borderColor: '#18181b', borderTopColor: 'transparent', margin: 0 }}></div>
                              <span>{uploadStatusText || 'Syncing All...'}</span>
                            </>
                          ) : (
                            <>
                              <CloudLightning size={14} />
                              <span>Sync All ({activeProjectDraftsCount})</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {!googleToken && stagedItems.length > 0 && (
                  <div className="settings-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid var(--color-zinc-800)', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                      <Folder size={20} style={{ color: 'var(--color-amber-500)', marginTop: '2px', flex: 'none' }} />
                      <div>
                        <h4 style={{ fontWeight: 600, color: 'var(--color-zinc-200)' }}>Connect Google Drive to Sync</h4>
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-500)', lineHeight: '1.4', marginTop: '2px' }}>
                          Sign in to sync your staged documents directly to your active project's Google Drive folder.
                        </p>
                      </div>
                    </div>
                    <button onClick={handleGoogleSignIn} className="btn btn-secondary" style={{ backgroundColor: '#fff', color: '#18181b', fontWeight: 700 }}>
                      <LogIn size={16} /> Sign In with Google
                    </button>
                  </div>
                )}
                
                {stagedItems.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.9rem', border: '1px dashed var(--color-zinc-800)', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                    <FileText size={24} style={{ color: 'var(--color-zinc-700)' }} />
                    No staged documents. Scanned checks and receipts waiting for sync will appear here.
                    <button className="btn btn-secondary" onClick={() => setActiveTab('scanner')} style={{ width: 'auto', marginTop: '8px', fontSize: '0.8rem' }}>
                      Go Scan Document
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {stagedItems.map(item => (
                      <StagingCard 
                        key={item.id}
                        stagedItem={item}
                        onEditClick={() => setEditingItemId(item.id)}
                        onUploadClick={() => handleOneShotSync(item.id)}
                        onDeleteClick={() => handleDeleteStaged(item.id)}
                        onAdjustTimer={(minutes) => handleAdjustTimer(item.id, minutes)}
                        onResetTimer={() => handleResetTimer(item.id)}
                        onDescriptionChange={(val) => handleUpdateDraftField(item.id, 'description', val)}
                        onCostCategoryChange={(val) => handleUpdateDraftField(item.id, 'costCategory', val)}
                        onLotNumberChange={(val) => handleUpdateDraftField(item.id, 'lotNumber', val)}
                        uploading={uploading === item.id || uploading === 'all'}
                        uploadStatusText={uploading === item.id ? uploadStatusText : ''}
                        googleToken={googleToken}
                        selectedFolder={selectedFolder}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key="history-subtab" className="slide-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Sync Log & History ({history.length})</h2>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      className="btn btn-secondary"
                      style={{
                        width: 'auto',
                        padding: '4px 10px',
                        fontSize: '0.74rem',
                        color: '#f87171',
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                        backgroundColor: 'rgba(239, 68, 68, 0.05)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Clear All</span>
                    </button>
                  )}
                </div>
                
                {history.length === 0 ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-zinc-500)', fontSize: '0.9rem', border: '1px dashed var(--color-zinc-800)', borderRadius: '12px' }}>
                    No documents uploaded yet. Scans will be logged here.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {history.map(item => (
                      <div key={item.id} className="history-item">
                        <div className="history-info" style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                          <div className="history-title-text" style={{ wordBreak: 'break-word' }}>{item.description}</div>
                          <div className="history-meta">
                            {item.vendor} • {item.dateTransaction || 'N/A'}
                          </div>
                          {item.tradeCategory && item.tradePhase && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-amber-400)', marginTop: '2px', fontWeight: 500 }}>
                              Logged: {item.tradeCategory.replace(/_/g, ' ').replace(/&/g, '&')} → {item.tradePhase}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: item.costCategory === 'labor' ? 'var(--color-blue-500)' : 'var(--color-amber-500)', textTransform: 'uppercase' }}>
                              {item.costCategory}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--color-zinc-600)' }}>•</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--color-zinc-500)' }}>Logged {item.dateLogged}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
                          <div className="history-price">${Number(item.amount).toFixed(2)}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {item.link ? (
                              <button 
                                type="button"
                                onClick={() => handleViewPDF(item)}
                                className="btn btn-secondary" 
                                style={{ padding: '4px 8px', fontSize: '0.75rem', width: 'auto', borderRadius: '6px', whiteSpace: 'nowrap' }}
                              >
                                View PDF
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--color-zinc-600)', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                                Downloaded
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteHistoryItem(item.id)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--color-zinc-500)',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: '4px'
                              }}
                              title="Delete log entry"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'dashboard' ? (
          <DashboardErrorBoundary>
            <Dashboard 
              googleToken={googleToken}
              activeProject={activeProject}
              selectedFolder={selectedFolder}
              onSessionExpired={handleSessionExpired}
              onRequestConnect={requestDriveAccessToken}
              onShowToast={setSuccess}
            />
          </DashboardErrorBoundary>
        ) : activeTab === 'xray' ? (
          <BlueprintPinboard
            googleToken={googleToken}
            activeProject={activeProject}
            selectedFolder={selectedFolder}
          />
        ) : (
          <Settings 
            googleToken={googleToken}
            setSelectedFolder={setSelectedFolder}
            googleUser={googleUser}
            onSignOut={handleSignOut}
            onSignIn={handleGoogleSignIn}
            projects={projects}
            setProjects={handleUpdateProjects}
            activeProject={activeProject}
            setActiveProject={setActiveProject}
            handleSelectActiveProject={handleSelectActiveProject}
          />
        )}
        </Suspense>
      </main>

      {/* 3. Navigation Footer - 5 Mobile-Optimized Tabs */}
      {!editingItemId && (
        <nav className="app-nav">
          <button 
            className={`nav-item ${activeTab === 'invoices' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('invoices');
            }}
            style={{ position: 'relative' }}
          >
            <div key={stagedItems.length} className={`nav-item-inner ${animateBadge ? 'badge-bounce-pop' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '100%' }}>
              <FileText size={20} />
              <span>Invoices</span>
            </div>
            {stagedItems.length > 0 && (
              <span key={`badge-${stagedItems.length}`} className={`nav-badge ${animateBadge ? 'badge-bounce-pop' : ''}`}>
                {stagedItems.length}
              </span>
            )}
          </button>
          <button 
            className={`nav-item ${activeTab === 'xray' ? 'active' : ''}`}
            onClick={() => setActiveTab('xray')}
          >
            <MapPin size={20} />
            <span>X-Ray</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <TrendingUp size={20} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <SettingsIcon size={20} />
            <span>Settings</span>
          </button>
        </nav>
      )}

      {/* Custom Delete Draft Confirmation Modal */}
      {/* Pick the project's Google Sheet when its folder holds more than one */}
      {sheetChoice && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1300,
          padding: '20px',
          backdropFilter: 'blur(4px)'
        }}>
          <div className="settings-card" style={{
            width: '100%',
            maxWidth: '360px',
            backgroundColor: 'var(--color-zinc-950)',
            border: '1px solid var(--color-zinc-800)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            borderTop: '4px solid var(--st-gold)'
          }}>
            <h4 style={{ fontWeight: 700, fontSize: '1rem', margin: 0, color: 'var(--st-text)' }}>
              Which Google Sheet is {sheetChoice.projectName}'s budget?
            </h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-zinc-400)', margin: 0, lineHeight: 1.4 }}>
              This project's folder has more than one spreadsheet. Tap the one the app should sync receipts into. You only do this once.
            </p>
            {sheetChoice.candidates.map(sheet => (
              <button
                key={sheet.id}
                type="button"
                className="btn btn-secondary"
                style={{ justifyContent: 'flex-start', padding: '12px', textAlign: 'left' }}
                onClick={() => chooseSheetForProject(sheet)}
              >
                {sheet.name}
              </button>
            ))}
            <button
              type="button"
              onClick={dismissSheetChoice}
              style={{ background: 'none', border: 'none', color: 'var(--color-zinc-500)', fontSize: '0.75rem', cursor: 'pointer', padding: '4px' }}
            >
              Decide later
            </button>
          </div>
        </div>
      )}

      {draftToDelete && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1300,
          padding: '20px',
          backdropFilter: 'blur(4px)'
        }}>
          <div className="settings-card" style={{
            width: '100%',
            maxWidth: '320px',
            backgroundColor: 'var(--color-zinc-950)',
            border: '1px solid var(--color-zinc-800)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            borderTop: '4px solid var(--color-rose-500)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <h4 style={{ 
                fontWeight: 700, 
                fontSize: '1.05rem', 
                color: 'var(--color-zinc-100)',
                fontFamily: 'var(--font-serif)',
                marginBottom: '8px'
              }}>
                Discard Draft
              </h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-zinc-400)', lineHeight: '1.4' }}>
                Are you sure you want to delete this draft?
                {draftToDelete.metadata?.description && (
                  <span style={{ display: 'block', marginTop: '6px', fontWeight: 600, color: 'var(--color-zinc-200)' }}>
                    "{draftToDelete.metadata.description}"
                  </span>
                )}
              </p>
            </div>
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setDraftToDelete(null)}
                style={{ padding: '8px 12px', fontSize: '0.85rem', flex: 1 }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-danger" 
                onClick={confirmDeleteDraft}
                style={{ padding: '8px 12px', fontSize: '0.85rem', flex: 1, backgroundColor: 'var(--color-rose-600)' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
