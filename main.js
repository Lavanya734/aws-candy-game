document.getElementById('playButton').addEventListener('click', function() {
    // Navigate to indexprev.html
    window.location.href = 'indexprev.html';  
});

//added for mobile
// Ensure all elements are fully loaded before adding event listeners
window.addEventListener('load', function() {
    // Add event listener for 'Know More' button
    const knowMoreButton = document.getElementById('retrieveButton');
    if (knowMoreButton) {
        knowMoreButton.addEventListener('click', function() {
            // Navigate to Cloud-into.html
            window.location.href = 'Cloud-into.html';  
        });
    }
});
