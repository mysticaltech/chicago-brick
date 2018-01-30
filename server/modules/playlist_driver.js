/* Copyright 2018 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

'use strict';

const monitor = require('server/monitoring/monitor');
const random = require('random-js')();
const time = require('server/util/time');
const wallGeometry = require('server/util/wall_geometry');
const debug = require('debug')('wall::playlist_driver');

const makeDriver = layoutSM => {
  let timer = 0;
  let playlist = null;
  // Order that we play the modules in.
  let modules = [];
  // Index of next layout in the playlist.
  let layoutIndex = 0;
  // Index of next module in the playlist.
  let moduleIndex = 0;
  // Timestamp of next layout change.
  let newLayoutTime = 0;
  // Timestamp of next module change.
  let newModuleTime = Infinity;
  
  let ret = {
    getNextDeadline() {
      return Math.min(newLayoutTime, newModuleTime);
    },
    getPlaylist() {
      return playlist;
    },
    driveStateMachine(newPlaylist) {
      playlist = newPlaylist;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }

      // Reset layout index.
      layoutIndex = -1;

      ret.nextLayout();
    },
    skipAhead() {
      // This skips to the next module in the current layout.
      // We need to cancel any existing timer, because we are disrupting the
      // normal timing.
      clearTimer(timer);
      // Now, force the next module to play.
      ret.nextModule();
    },
    nextLayout() {
      // Update layoutIndex.
      layoutIndex = (layoutIndex + 1) % playlist.length;
      
      // Show this layout next:
      let layout = playlist[layoutIndex];
      
      // Reset moduleIndex
      moduleIndex = -1;

      // The time that we'll switch to a new layout.
      newLayoutTime = time.inFuture(layout.duration * 1000);

      if (monitor.isEnabled()) {
        monitor.update({playlist: {
          time: time.now(),
          event: `change layout`,
          deadline: newLayoutTime
        }});
      }

      debug(`Next Layout: ${layoutIndex}`);

      layoutSM.fadeOut().then(() => {
        // Shuffle the module list:
        modules = Array.from(layout.modules);
        random.shuffle(modules);

        Promise.all(layout.modules.map(m => m.whenLoadedPromise)).then(() => ret.nextModule());
      });
    },
    nextModule() {
      moduleIndex = (moduleIndex + 1) % modules.length;

      layoutSM.setErrorListener(error => {
        // Stop normal advancement.
        clearTimeout(timer);
        nextModule();
      });

      // The current layout.
      let layout = playlist[layoutIndex];
      
      // The time that we'll switch to the next module.
      newModuleTime = time.inFuture(layout.moduleDuration * 1000);

      // Tell the layout to play the next module in the list.
      layoutSM.playModule(modules[moduleIndex]);

      if (monitor.isEnabled()) {
        monitor.update({playlist: {
          time: time.now(),
          event: `change module`,
          deadline: Math.min(newModuleTime, newLayoutTime)
        }});
      }

      // Now, in so many seconds, we'll need to switch to another module 
      // or another layout. How much time do we have?
      if (newLayoutTime < newModuleTime) {
        timer = setTimeout(() => ret.nextLayout(), time.until(newLayoutTime));
      } else {
        timer = setTimeout(() => ret.nextModule(), time.until(newModuleTime));
      }
    },
  };
  return ret;
}

module.exports = {
  makeDriver
};
