import React from "react";
import createReactClass from "create-react-class";
import ValidationMixin from "react-validation-mixin";
import Joi from "joi-browser";
import Scene from "components/uploader/scene";
import AppActions from "actions/actions";
import imageryValidations from "components/shared/imagery_validations";
import _ from "lodash";

import PlusIcon from "mdi-react/PlusIcon";

import config from "config";
import api from "utils/api";

// Sanity note:
// There are some places where the component state is being altered directly.
// This happens because of javascript objects work. Ex:
//   onSceneValueChange: function (sceneIndex, fieldName, fieldValue) {
//     var scenes = this.state.scenes;
//     scenes[sceneIndex][fieldName] = fieldValue;
//     this.setState({scenes: scenes});
//   },
// The solution would be to clone the state every time, but since we're
// ALWAYS calling setState after one of these changes, it's not a problem.

export default createReactClass({
  displayName: "Home",

  mixins: [ValidationMixin],

  validatorTypes: {
    scenes: Joi.array().items(
      Joi.object().keys(
        _.assign(imageryValidations, {
          "img-loc": Joi.array()
            .min(1)
            .items(
              Joi.object().keys({
                url: Joi.string()
                  .uri()
                  .required()
                  .label("Imagery url"),
                origin: Joi.string()
                  .required()
                  .label("Imagery file origin"),
                file: Joi.label("File").when("origin", {
                  is: "upload",
                  then: Joi.object().required()
                })
              })
            )
            .label("Imagery location")
        })
      )
    )
  },

  // Store entered values to these values in order to prepopulate the form on the next visit
  fieldsToPrepopulate: {
    scene: [
      "title",
      "platform-type",
      "sensor",
      "date-start",
      "dte-end",
      "tile-url",
      "provider",
      "contact-type",
      "contact-name",
      "contact-email",
      "license",
      "tags"
    ]
  },

  getInitialState: function() {
    return {
      loading: false,
      // Form properties.
      scenes: [this.getSceneDataTemplate()],
      uploadActive: false,
      uploadProgress: 0,
      uploadError: false,
      uploadStatus: ""
    };
  },

  getSceneDataTemplate: function() {
    var midnight = new Date();
    midnight.setMilliseconds(0);
    midnight.setSeconds(0);
    midnight.setMinutes(0);
    midnight.setHours(0);
    var now = new Date();

    let defaults = {
      title: "",
      "platform-type": "satellite",
      sensor: "",
      "date-start": midnight.toISOString(),
      "date-end": now.toISOString(),
      "img-loc": [],
      "tile-url": "",
      provider: "",
      "contact-type": "uploader",
      "contact-name": "",
      "contact-email": "",
      license: "CC-BY 4.0",
      tags: ""
    };

    // Merge in any fields from a previous upload
    defaults = _.defaults(
      JSON.parse(localStorage.getItem("upload-form-fields")) || {},
      defaults
    );

    return defaults;
  },

  getSceneImgLocTemplate: function() {
    return {
      url: "",
      origin: ""
    };
  },

  addScene: function() {
    var scenes = this.state.scenes;
    scenes.push(this.getSceneDataTemplate());
    this.setState({ scenes: scenes });
  },

  removeScene: function(sceneIndex) {
    var scenes = this.state.scenes;
    scenes.splice(sceneIndex, 1);
    this.setState({ scenes: scenes });
  },

  addImageryLocationToScene: function(sceneIndex, origin) {
    let scenes = this.state.scenes;
    let tmp = this.getSceneImgLocTemplate();
    tmp.origin = origin;
    scenes[sceneIndex]["img-loc"].push(tmp);
    this.setState({ scenes: scenes });
  },

  removeImageryLocatioFromScene: function(sceneIndex, imgLocIndex) {
    var scenes = this.state.scenes;
    scenes[sceneIndex]["img-loc"].splice(imgLocIndex, 1);
    this.setState({ scenes: scenes });
  },

  onSceneValueChange: function(sceneIndex, fieldName, fieldValue) {
    var scenes = this.state.scenes;
    scenes[sceneIndex][fieldName] = fieldValue;
    this.setState({ scenes: scenes });
  },

  onValueChange: function(event) {
    var data = {};
    data[event.target.name] = event.target.value;
    this.setState(data);
  },

  resetForm: function() {
    this.setState({
      scenes: [this.getSceneDataTemplate()]
    });
  },

  uploadFile: function(file, callback) {
    api({
      uri: "/uploads/url",
      auth: true,
      method: "POST",
      body: {
        name: file.newName,
        type: file.data.type
      }
    }).then(data => {
      callback(null, {
        type: "beforeSend"
      });
      this.xhrUploadToS3(data.results.url, file, callback);
    });
  },

  xhrUploadToS3: function(presignedUrl, file, callback) {
    let xhr = new window.XMLHttpRequest();
    xhr.upload.addEventListener(
      "progress",
      function(evt) {
        if (evt.lengthComputable) {
          return callback(null, {
            type: "progress",
            fileName: file.newName,
            val: evt.loaded
          });
        }
      },
      false
    );
    xhr.addEventListener("error", e => {
      callback(e);
    });
    xhr.addEventListener("load", e => {
      callback(null, {
        type: "success",
        val: e
      });
    });
    xhr.responseType = "text";
    xhr.open("PUT", presignedUrl, true);
    xhr.send(file.data);
  },

  onSubmit: function(event) {
    event.preventDefault();

    // Warning... Controlled HACK.
    // The state should never be changed in this way as it doesn't trigger
    // a render, however it will be updated by the validate function later on.
    // This is needed to clear previous errors as the plugin doesn't handle
    // arrays of objects specially well.
    this.state.errors = {}; // eslint-disable-line

    this.validate(
      function(error, validationErrors) {
        if (error) {
          console.log(validationErrors);
          AppActions.showNotification("alert", "Form contains errors!");
        } else {
          if (this.state.loading) {
            // Submit already in process.
            return;
          }
          this.setState({ loading: true });

          AppActions.clearNotification();

          // All is well.
          // SUBMIT DATA.
          //
          // 1 - Prepare data in state.
          // 2 - Submit.
          // 3 - Set form feedback with -- this.setFormFeedback(type, message);
          //   - TYPE can be: alert success warning info
          // 4 - Hide loading. -- this.setState({loading: false});
          // 5 - Reset form when success. -- this.resetForm();

          var data = {
            scenes: this.state.scenes.map(function(scene) {
              var contact = null;
              if (scene["contact-type"] === "other") {
                contact = {
                  name: scene["contact-name"],
                  email: scene["contact-email"]
                };
              }

              var tms = scene["tile-url"].trim();
              tms = tms.length === 0 ? undefined : tms;

              // Generate random filenames, to avoid collisions at the API
              const randomizeName = filename => {
                const ext = filename.substr(filename.lastIndexOf("."));
                const basename = filename.replace(ext, "");
                const randStr = Math.random()
                  .toString(36)
                  .substring(5);
                return `${basename}-${randStr}${ext}`;
              };
              let files = [];
              let urls = [];
              scene["img-loc"].forEach(o => {
                if (o.file) {
                  const name = randomizeName(o.file.name);
                  files.push({ newName: name, data: o.file });
                  urls.unshift(
                    "https://s3.amazonaws.com/" +
                      config.uploadBucket +
                      "/" +
                      name
                  );
                } else {
                  urls.push(o.url);
                }
              });

              return {
                contact: contact,
                title: scene.title,
                provider: scene.provider,
                platform: scene["platform-type"],
                sensor: scene.sensor,
                acquisition_start: scene["date-start"],
                acquisition_end: scene["date-end"],
                tms: tms,
                license: scene.license,
                tags: scene.tags,
                urls: urls,
                files: files
              };
            })
          };

          // Use the values from the first dataset/scene to save for prepopulation of
          // future uploads
          localStorage.setItem(
            "upload-form-fields",
            JSON.stringify(this.state.scenes[0])
          );

          // Gather list of files to upload
          let uploads = [];
          let totalBytes = 0;
          data.scenes.forEach(scene => {
            if (scene.files.length) {
              scene.files.forEach(file => {
                totalBytes += file.data.size;
                if (file.data) uploads.push(file);
              });
            }
            // Remove file references from JSON data (not saved in database)
            delete scene.files;
          });
          const totalFiles = uploads.length;
          if (!totalFiles) {
            // Submit the form now
            this.submitData(data);
          } else {
            // Upload list of files before submitting the form
            let progressStats = {};
            uploads.forEach(file => {
              // Init progress status to 0
              progressStats[file.data.name] = 0;
              this.uploadFile(file, (err, result) => {
                if (err) {
                  console.log("error", err);
                  this.setState({
                    uploadError: true,
                    uploadActive: false,
                    loading: false
                  });
                  AppActions.showNotification(
                    "alert",
                    <span>There was a problem uploading the files.</span>
                  );
                  return;
                }
                if (result.type === "progress") {
                  const { fileName, val } = result;
                  // Update progress stats.
                  progressStats[fileName] = val;
                  let totalBytesComplete = _.reduce(
                    progressStats,
                    (sum, n) => sum + n,
                    0
                  );
                  let percentComplete = totalBytesComplete / totalBytes * 100;
                  let percentDisplay = Math.round(percentComplete);

                  let uploadStatus = "";
                  if (totalFiles === 1) {
                    uploadStatus = `Uploading image (${percentDisplay}%)...`;
                  } else {
                    uploadStatus = `Uploading ${totalFiles} images (${percentDisplay}%)...`;
                  }
                  this.setState({
                    uploadProgress: percentComplete,
                    uploadStatus: uploadStatus
                  });
                } else if (result.type === "beforeSend") {
                  this.setState({ uploadError: false, uploadActive: true });
                } else if (
                  result.type === "success" &&
                  this.state.uploadProgress >= 100
                ) {
                  this.setState({
                    uploadError: false,
                    uploadActive: false,
                    uploadStatus: "Upload complete!"
                  });
                  this.submitData(data);
                }
              });
            });
          }
        }
      }.bind(this)
    );
  },

  submitData: function(data) {
    api({
      uri: "/uploads",
      auth: true,
      method: "POST",
      body: data
    }).then(data => {
      this.setState({ loading: false });
      var id = data.results.upload;

      AppActions.showNotification(
        "success",
        <span>
          Your upload request was successfully submitted and is being processed.{" "}
          <a href={"#/upload/status/" + id}>Check upload status.</a>
        </span>
      );
    });
  },

  renderErrorMessage: function(message) {
    message = message || "";
    if (message.trim().length === 0) {
      return null;
    }

    return <p className="message message-alert">{message}</p>;
  },

  renderScene: function(data, index) {
    return (
      <Scene
        type={"uploader"}
        key={index}
        total={this.state.scenes.length}
        index={index}
        data={data}
        onValueChange={this.onSceneValueChange}
        removeScene={this.removeScene}
        addImageryLocationToScene={this.addImageryLocationToScene}
        removeImageryLocatioFromScene={this.removeImageryLocatioFromScene}
        handleValidation={this.handleValidation}
        getValidationMessages={this.getValidationMessages}
        renderErrorMessage={this.renderErrorMessage}
      />
    );
  },

  render: function() {
    return (
      <div className="form-wrapper">
        <section className="panel upload-panel">
          <header className="panel-header">
            <div className="panel-headline">
              <h1 className="panel-title">Upload Imagery</h1>
            </div>
          </header>
          <div className="panel-body">
            <div className="meter">
              <span />
            </div>

            <form id="upload-form" className="form-horizontal">
              <div className="meter">
                <span />
              </div>

              {this.state.scenes.map(this.renderScene)}

              <div className="form-extra-actions">
                <button
                  type="button"
                  className="bttn bttn-secondary bttn-block bttn-icon"
                  onClick={this.addScene}
                  title="Add new dataset"
                >
                  <span>New dataset</span>
                  <PlusIcon />
                </button>
              </div>

              <div className="form-note">
                <p>
                  By submitting imagery to OpenAerialMap, you agree to place
                  your imagery into the{" "}
                  <a href="https://github.com/openimagerynetwork/oin-register#open-imagery-network">
                    Open Imagery Network (OIN)
                  </a>
                  . All imagery contained in OIN is licensed{" "}
                  <a href="https://creativecommons.org/licenses/by/4.0/">
                    CC-BY 4.0
                  </a>
                  , with attribution as contributors of Open Imagery Network.
                  All imagery is available to be traced in OpenStreetMap.
                </p>
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="bttn bttn-lg bttn-block bttn-submit"
                  onClick={this.onSubmit}
                >
                  Submit
                </button>
                <div
                  id="upload-progress"
                  className={this.state.uploadActive ? "" : "upload-inactive"}
                >
                  <div className="meter">
                    <span style={{ width: this.state.uploadProgress + "%" }} />
                  </div>
                  <span className="upload-status">
                    {this.state.uploadStatus}
                  </span>
                </div>
              </div>
            </form>
          </div>
          <footer className="panel-footer" />
        </section>
      </div>
    );
  }
});
