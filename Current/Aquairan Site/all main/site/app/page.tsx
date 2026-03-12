"use client";

import { useState, useRef } from 'react';

export default function Home() {
  // React State to manage our markers and modal
  const [markers, setMarkers] = useState([]);
  const [pendingCoords, setPendingCoords] = useState(null);
  const [activeMarkerId, setActiveMarkerId] = useState(null);
  
  // Refs to access DOM elements directly
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);

  // 1. Handle clicking the blueprint
  const handleMapClick = (e) => {
    // Prevent triggering if clicking an existing marker
    if (e.target.className.includes('marker')) return;

    const rect = containerRef.current.getBoundingClientRect();
    const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100;

    setPendingCoords({ x: xPercent, y: yPercent });
    
    // Trigger the hidden file input
    fileInputRef.current.click();
  };

  // 2. Handle uploading the photos
  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files.length === 0 || !pendingCoords) return;

    const photoUrls = [];
    for (let i = 0; i < files.length; i++) {
      photoUrls.push(URL.createObjectURL(files[i]));
    }

    const newMarker = {
      id: Date.now().toString(), // Use timestamp for a unique ID
      x: pendingCoords.x,
      y: pendingCoords.y,
      photos: photoUrls,
    };

    setMarkers([...markers, newMarker]);
    
    // Reset inputs
    fileInputRef.current.value = '';
    setPendingCoords(null);
  };

  // 3. Handle clicking a blue dot
  const handleMarkerClick = (e, id) => {
    e.stopPropagation(); // Stop the map click event from firing
    setActiveMarkerId(id);
  };

  const closeModal = () => {
    setActiveMarkerId(null);
  };

  // Find the currently active marker to display its photos in the modal
  const activeMarker = markers.find(m => m.id === activeMarkerId);

  return (
    <main>
      <h1>Site Plan Annotator</h1>
      <p>Click anywhere on the plan to mark a change order and upload photos. Click an existing blue dot to view the photos.</p>

      {/* Blueprint Container */}
      <div 
        id="plan-container" 
        ref={containerRef} 
        onClick={handleMapClick}
      >
        <img id="site-plan" src="/Sitefloor.jpg" alt="Site Plan" />
        
        {/* Render all markers from state */}
        {markers.map((marker) => (
          <div
            key={marker.id}
            className="marker"
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            onClick={(e) => handleMarkerClick(e, marker.id)}
          />
        ))}
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Modal - only renders if activeMarkerId is set */}
      {activeMarker && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Change Order Photos</h2>
            <div className="modal-images">
              {activeMarker.photos.length > 0 ? (
                activeMarker.photos.map((url, idx) => (
                  <img key={idx} src={url} alt={`Change order ${idx + 1}`} />
                ))
              ) : (
                <p>No photos attached.</p>
              )}
            </div>
            <button className="close-btn" onClick={closeModal}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
}