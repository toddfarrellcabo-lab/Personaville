(function(){
  function initPersonavilleHeader(root){
    const scope = root || document;
    const header = scope.querySelector("#personaville-header");
    const button = scope.querySelector("#playButton");
    const music = scope.querySelector("#bgMusic");
    const image = scope.querySelector(".personaville-hero__image");
    const status = scope.querySelector("#personavilleAudioStatus");

    if(image && image.dataset.initialized !== "true"){
      image.dataset.initialized = "true";
      image.addEventListener("error", () => {
        image.classList.add("is-hidden");
        image.removeAttribute("src");
        header?.classList.add("has-media-error");
        console.warn("Personaville hero image could not be loaded; continuing with the compact player available.");
      }, {once:true});
    }

    if(!button || !music || button.dataset.initialized === "true") return;
    button.dataset.initialized = "true";

    function setStatus(text){
      if(status) status.textContent = text;
    }

    function showStoppedState(){
      button.textContent = "Play";
      button.classList.remove("is-playing");
      header?.classList.remove("is-playing");
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Play Personaville music");
      button.title = "Play music";
      setStatus("Paused");
    }

    function showPlayingState(){
      button.textContent = "Stop";
      button.classList.add("is-playing");
      button.classList.remove("has-error");
      header?.classList.add("is-playing");
      header?.classList.remove("has-media-error");
      button.setAttribute("aria-pressed", "true");
      button.setAttribute("aria-label", "Stop Personaville music");
      button.title = "Stop music";
      setStatus("Playing");
    }

    button.addEventListener("click", async () => {
      if(!music.paused){
        music.pause();
        showStoppedState();
        return;
      }

      try{
        await music.play();
        showPlayingState();
      }catch(error){
        showStoppedState();
        button.classList.add("has-error");
        header?.classList.add("has-media-error");
        button.title = "The audio file could not be played";
        setStatus("Audio unavailable");
        console.warn("Personaville audio could not play:", error);
      }
    });

    music.addEventListener("play", showPlayingState);
    music.addEventListener("pause", showStoppedState);
    music.addEventListener("error", () => {
      showStoppedState();
      button.classList.add("has-error");
      header?.classList.add("has-media-error");
      button.title = "Audio file not found or unsupported";
      setStatus("Audio unavailable");
      console.warn("Personaville audio file could not be loaded.");
    });

    showStoppedState();
  }

  function setPersonavilleHeaderState(state){
    const header = document.getElementById("personaville-header");
    if(!header) return;
    header.dataset.state = state === "full" ? "full" : "compact";
  }

  window.initPersonavilleHeader = initPersonavilleHeader;
  window.setPersonavilleHeaderState = setPersonavilleHeaderState;
})();
