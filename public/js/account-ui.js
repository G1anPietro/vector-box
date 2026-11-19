// js/account-ui.js — after saving a form the page is drawn again from the top: bring the message into view so it is not missed.
(function () {
    'use strict';
    var n = document.querySelector('.notice');
    if (n && n.scrollIntoView) n.scrollIntoView({ block: "center" });
})();
