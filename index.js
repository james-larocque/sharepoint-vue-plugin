/*
    SharePoint Vue Plug-in
    https://github.com/BenRunInBay

    Last updated 2019-03-06

    Vue main.js entry:
        import SharePoint from '@/lib/SharePoint'
        Vue.use(SharePoint, '/sites/MySite/', {
          productionHosts: ["myhost.sharepoint.com"]
        })

    Within the Vue app or component, refer to the SharePoint as this.$sp
        created() {
          this.$sp.getFormDigest().then(() => {
            // Once completed, you can start recording data to a list by specifying list name
            // and an object containing the column names of that list that you want to fill.
            this.$sp.addListItem({
              listName: 'MyList',
              itemData: { Title: 'title', CustomColumn: 'custom value' },
            });
          })
        }
*/
/* Comment out the following line if not using this in a webpack build system: */
import axios from "axios";

// artificial delay when working in Dev mode
const constDevLoadDelay = 1000;

/* Modify these default configurations for your SharePoint environment */
let baseConfig = {
    productionHosts: ["yoursite.sharepoint.com"],
    showConsoleActivityInDev: true,
    profileDefaultSelect:
      "AccountName,DisplayName,Email,PictureUrl,PersonalUrl,Title,UserProfileProperties",
    myProfileDefaultSelect:
      "DisplayName,AccountName,Email,PictureUrl,PersonalUrl,Title",
    listPath: "_api/Web/Lists/",
    currentUserPropertiesPrefix:
      "/_api/sp.userprofiles.peoplemanager/getmyproperties/?$select=",
    peopleManagerbaseUrl:
      "/_api/sp.userprofiles.peoplemanager/GetPropertiesFor(accountName=@v)?@v=",
    siteUserPrefix: "_api/web/siteusers(@v)?@v='",
    ensureUserUrl: "_api/web/ensureuser",
    accountNamePrefix: "i:0#.f|membership|",
    sendEmailPath: "_api/SP.Utilities.Utility.SendEmail",
    formDigestRefreshInterval: 19 * 60 * 1000
  },
  config = baseConfig;

/*
    Vue installer

    Vue.use(SharePoint, "/sites/MySite/", {
        productionHosts: ["production.com"]
    })
*/
export default {
  install(Vue, baseUrl, configUpdates) {
    config = Object.assign(baseConfig, configUpdates);
    let sp = new SharePoint(baseUrl);
    Object.defineProperty(Vue.prototype, "$sp", { value: sp });
  }
};

class SharePoint {
  constructor(baseUrl) {
    // properties
    this.baseUrl = baseUrl;
    this.digestValue = null;
    this.inProduction = false;

    if (!baseUrl) {
      // guess at base URL
      let paths =
          location && location.pathname
            ? location.pathname.match(/^\/\w+\/\w+\//g)
            : null,
        path = paths && paths.length ? paths[0] : null;
      this.baseUrl = path;
    }

    if (Array.isArray(config.productionHosts))
      config.productionHosts.forEach(host => {
        this.inProduction =
          this.inProduction || location.href.indexOf(host) >= 0;
      });
  }

  /* 
    Obtain SharePoint form digest value used to validate that user has authority to write data to a list in that SP site.
      If successful, resolves with retrieved digestValue.
      Also sets timer to refresh digest on a periodic basis.
      Returns Promise
  */
  getFormDigest() {
    let me = this;
    setInterval(() => {
      me.getFormDigest().catch(error => {
        return;
      });
      me.log("Refreshed digest value");
    }, config.formDigestRefreshInterval);
    return new Promise((resolve, reject) => {
      if (!me.inProduction) {
        me.digestValue = "dev digest value";
        resolve("dev digest value");
      } else {
        axios
          .post(
            me.baseUrl + "_api/contextinfo",
            {},
            {
              withCredentials: true,
              headers: {
                Accept: "application/json; odata=verbose",
                "X-HTTP-Method": "POST"
              }
            }
          )
          .then(function(response) {
            if (response && response.data) {
              if (response.data.d && response.data.d.GetContextWebInformation)
                me.digestValue =
                  response.data.d.GetContextWebInformation.FormDigestValue;
              else if (response.data.FormDigestValue)
                me.digestValue = response.data.FormDigestValue;
              resolve(me.digestValue);
            }
            reject("No digest provided");
          })
          .catch(function(error) {
            reject(error);
          });
      }
    });
  }

  /* True if request digest is known */
  isWriteReady() {
    return (
      (this.inProduction && this.digestValue != null) ||
      this.inProduction == false
    );
  }

  /*
      Get data
          baseUrl: (optional)
          path: (after baseUrl),
          devStaticDataUrl: url of local JSON file to use for testing/development
        Returns Promise
  */
  _get({ baseUrl, path, url, devStaticDataUrl }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (me.inProduction) {
        axios
          .get(url ? url : (baseUrl ? baseUrl : me.baseUrl) + path, {
            cache: false,
            withCredentials: true,
            headers: {
              Accept: "application/json;odata=verbose",
              "Content-Type": "application/json;odata=verbose"
            }
          })
          .then(response => {
            if (response && response.data) {
              if (response.data.d && response.data.d.results)
                resolve(response.data.d.results);
              else if (response.data.d) resolve(response.data.d);
              else resolve(response.data);
            }
          })
          .catch(error => {
            reject(error);
          });
      } else if (devStaticDataUrl) {
        axios
          .get(devStaticDataUrl, {})
          .then(response => {
            if (response) resolve(response.data);
          })
          .catch(error => {
            reject(error);
          });
      } else {
        reject("No static data in dev");
      }
    });
  }
  /*
      Get data from a list
          baseUrl: <optional url>,
          listName: 'list name',
          select: 'field1,field2,field3',
          filter: "field2 eq 'value'",
          expand: 'field1',
          orderby: "field1 asc|desc",
          top: <optional number>,
          devStaticDataUrl: url of local JSON file to use for testing/development
        Returns Promise
  */
  getListData({
    baseUrl,
    listName,
    select,
    filter,
    expand,
    orderby,
    top,
    devStaticDataUrl
  }) {
    let me = this;
    return new Promise((resolve, reject) => {
      var q = [];
      if (top) q.push("$top=" + top);
      if (orderby) q.push("$orderby=" + orderby);
      if (select) q.push("$select=" + select);
      if (expand) q.push("$expand=" + expand);
      if (filter) q.push("$filter=" + filter);
      me._get({
        baseUrl: baseUrl,
        path: `${config.listPath}getbytitle('${listName}')/items?${q.join(
          "&"
        )}`,
        devStaticDataUrl: devStaticDataUrl
      })
        .then(data => {
          resolve(data);
        })
        .catch(error => {
          reject(error);
        });
    });
  }
  /*
      Post data
  */
  _post({ path, url, data }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (path && data) {
        if (!me.inProduction) {
          me.log("Post to SharePoint: " + JSON.stringify(data));
          resolve(data, "dev item url");
        } else {
          let postUrl = url ? url : me.baseUrl + path;
          axios
            .post(postUrl, data, {
              withCredentials: true,
              headers: {
                Accept: "application/json;odata=verbose",
                "Content-Type": "application/json;odata=verbose",
                "X-RequestDigest": me.digestValue,
                "X-HTTP-Method": "POST"
              }
            })
            .then(function(response) {
              let data =
                  response && response.data && response.data.d
                    ? response.data.d
                    : null,
                metadata = data ? data.__metadata : null,
                results = data ? data.results : null;
              if (metadata) resolve(data, metadata.uri, metadata.etag);
              else if (results) resolve(results);
              else resolve(response.data);
            })
            .catch(function(error) {
              reject(error);
            });
        }
      } else reject("No path or data provided");
    });
  }
  /*
      Write data to a list, appending it as a new item
  */
  addListItem({ listName, itemData }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (listName && itemData) {
        let addData = Object.assign(
            { __metadata: { type: me.getListItemType(listName) } },
            itemData
          ),
          path = config.listPath + `getbytitle('${listName}')/items`;
        me.log(addData);
        me._post({ path: path, data: addData })
          .then(responseData => {
            resolve(responseData);
          })
          .catch(error => {
            reject(error);
          });
      } else reject("No list or data provided");
    });
  }
  /*
      Write data to a list, updating an existing item
      First, reloads items to obtain etag value, then posts updates using the etag value and request digest
  */
  updateListItem({ listName, itemData, itemUrl }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (listName && itemUrl && itemData) {
        if (!me.inProduction) {
          resolve(itemData);
        } else {
          // obtain updated etag
          me._get({
            url: itemUrl + "?$select=ID"
          })
            .then(data => {
              let etag = me.getETag(data);
              if (etag) {
                let updateData = Object.assign(
                  {
                    __metadata: {
                      type: me.getListItemType(listName)
                    }
                  },
                  itemData
                );
                axios
                  .post(itemUrl, updateData, {
                    withCredentials: true,
                    headers: {
                      Accept: "application/json;odata=verbose",
                      "Content-Type": "application/json;odata=verbose",
                      "X-RequestDigest": me.digestValue,
                      "X-HTTP-Method": "MERGE",
                      "If-Match": etag
                    }
                  })
                  .then(function(response) {
                    resolve(response.data);
                  })
                  .catch(function(error) {
                    reject(error);
                  });
              }
            })
            .catch(error => {
              reject(error);
            });
        }
      } else reject("No list, item URL or data provided");
    });
  }

  /*
      Delete an item
  */
  deleteListItem({ itemUrl }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (itemUrl) {
        if (!me.inProduction) {
          me.log("Delete item in SharePoint: " + JSON.stringify(itemUrl));
          resolve();
        } else {
          axios
            .post(itemUrl, null, {
              withCredentials: true,
              headers: {
                "X-RequestDigest": me.digestValue,
                "IF-MATCH": "*",
                "X-HTTP-Method": "DELETE"
              }
            })
            .then(function(response) {
              resolve(response);
            })
            .catch(function(error) {
              reject(error);
            });
        }
      }
    });
  }

  /*
    Post a CAML query and return the response
  */
  camlQuery({ listName, queryXml, devStaticDataUrl }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (listName && queryXml) {
        me._post({
          path: `${config.listPath}getbytitle('${listName}')/getitems`,
          data: {
            query: {
              __metadata: { type: "SP.CamlQuery" },
              ViewXml: queryXml
            }
          },
          devStaticDataUrl: devStaticDataUrl
        })
          .then(results => {
            resolve(results);
          })
          .catch(error => {
            reject(error);
          });
      } else reject("No list or query provided");
    });
  }

  /*
    Get ODATA-formatted OR query to retrieve matching optionsArray values
      query = getQueryFilter(["Americas", "EMEIA"], "Area")
      returns: (Area eq 'Americas' or Area eq 'EMEIA')
  */
  orQueryFromArray(optionsArray, fieldName) {
    if (Array.isArray(optionsArray) && fieldName) {
      let searchPattern = "";
      optionsArray.forEach(compare => {
        if (compare) {
          searchPattern +=
            (searchPattern.length ? " or " : "") +
            `${fieldName} eq '${encodeURIComponent(compare)}'`;
        }
      });
      return "(" + searchPattern + ")";
    } else return "";
  }
  /*
    Get ODATA-formatted AND query to retrieve matching optionsArray values
      query = getQueryFilter(["Americas", "EMEIA"], "Area")
      returns: (Area eq 'Americas' and Area eq 'EMEIA')
  */
  andQueryFromArray(optionsArray, fieldName) {
    if (Array.isArray(optionsArray) && fieldName) {
      let searchPattern = "";
      optionsArray.forEach(compare => {
        if (compare) {
          searchPattern +=
            (searchPattern.length ? " and " : "") +
            `${fieldName} eq '${encodeURIComponent(compare)}'`;
        }
      });
      return "(" + searchPattern + ")";
    } else return "";
  }

  /*
    Get the update/delete item URL from the list item
  */
  getItemUrl(listItem) {
    if (listItem && listItem.__metadata) return listItem.__metadata.uri;
    else return null;
  }
  /*
    Get the etag version number from the list item
  */
  getETag(listItem) {
    if (listItem && listItem.__metadata) return listItem.__metadata.etag;
    else return null;
  }

  /*
    Cast date string as a date object
    Or return null if it can't be converted to a date object
  */
  castAsDate(dateValue) {
    if (dateValue) {
      let d = new Date(dateValue);
      if (isNaN(d) == false) return d;
      else return null;
    } else return null;
  }

  /*
    Utility methods for preparing data for update and add methods
  */
  getMatchingIDs(allTextAndIDs, keys) {
    let IDs = [];
    keys.forEach(key => {
      let id = allTextAndIDs[key];
      if (id > 0) IDs.push(id);
    });
    return IDs;
  }
  castToDateData(d) {
    if (d && typeof d == "object" && typeof d.toISOString == "function")
      return d.toISOString();
    else return null;
  }
  castToMultiValueData(list) {
    if (Array.isArray(list))
      return {
        results: list
      };
    else
      return {
        results: []
      };
  }

  /*
  Retrieve profile data
      accountName is in format i:0#.f|membership|first.last@ey.com
      OR email: name@domain.com
      property: <optional>
  If property is not provided, then these fields are provided:
      {
        PictureUrl,
        Email,
        DisplayName,
        PersonalUrl,
        Title (rank)
      }
 */
  retrievePeopleProfile({ accountName, email = null, property = null }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (me.inProduction) {
        let account = accountName;
        if (!account && email) account = config.accountNamePrefix + email;
        if (account) {
          axios
            .get(
              config.peopleManagerbaseUrl +
                `'${escape(account)}'` +
                (property
                  ? "&$select=" + property
                  : "&$select=" + config.profileDefaultSelect),
              {
                cache: false,
                withCredentials: true,
                headers: {
                  Accept: "application/json;odata=verbose",
                  "Content-Type": "application/json;odata=verbose"
                }
              }
            )
            .then(function(response) {
              if (response && response.data && response.data.d)
                resolve(response.data.d);
            })
            .catch(function(error) {
              reject(error);
            });
        } else reject("No account name provided");
      } else
        setTimeout(function() {
          resolve({
            DisplayName: "TEST NAME",
            Email: "test@ey.com",
            PersonalUrl: "",
            Title: "Staff"
          });
        }, constDevLoadDelay);
    });
  }
  /*
  Retrieve profile of current user
  Promised:
    {
      DisplayName,
      AccountName,
      Email,
      PersonalUrl,
      PicturUrl,
      Title (rank)
    }
  */
  retrieveCurrentUserProfile() {
    let me = this;
    return new Promise((resolve, reject) => {
      if (me.inProduction)
        axios
          .get(
            config.currentUserPropertiesPrefix + config.myProfileDefaultSelect,
            {
              cache: false,
              withCredentials: true,
              headers: {
                Accept: "application/json;odata=verbose",
                "Content-Type": "application/json;odata=verbose"
              }
            }
          )
          .then(function(response) {
            if (response && response.data && response.data.d)
              resolve(response.data.d);
          })
          .catch(function(error) {
            reject(error);
          });
      else
        setTimeout(function() {
          resolve({
            DisplayName: "CURRENT USER"
          });
        }, constDevLoadDelay);
    });
  }
  /*
    Check if user exists on current site. If not, add them.
    Pass their ID to the resolve handler.
        accountName: i:0#.f|membership|name@domain,
  */
  ensureSiteUserId({ accountName }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (me.inProduction)
        axios
          .post(
            me.baseUrl + config.ensureUserUrl,
            {
              logonName: accountName
            },
            {
              cache: false,
              withCredentials: true,
              headers: {
                "X-RequestDigest": me.digestValue,
                accept: "application/json;odata=verbose"
              }
            }
          )
          .then(function(response) {
            if (response && response.data) {
              resolve(response.data.Id);
            }
          })
          .catch(function(error) {
            reject(error);
          });
      else resolve(1234);
    });
  }
  /*
    Send email using the SharePoint server.
    Recipients must be existing users in the SharePoint environment.
      from: "your.name@domain.com",
      to: ["recipient1@domain.com", "recipient2@domain.com"],
      subject: "Email subject",
      body: "",
  */
  sendEmail({ from, to, subject, body }) {
    let me = this;
    return new Promise((resolve, reject) => {
      if (from && to && subject) {
        let toArray = Array.isArray(to) ? to : [to];
        let mailData = {
          properties: {
            __metadata: {
              type: "SP.Utilities.EmailProperties"
            },
            From: from,
            To: {
              results: toArray
            },
            Subject: subject,
            Body: body
          }
        };
        if (me.inProduction)
          axios
            .post(me.baseUrl + config.sendEmailPath, mailData, {
              withCredentials: true,
              headers: {
                Accept: "application/json;odata=verbose",
                "Content-Type": "application/json;odata=verbose",
                "X-RequestDigest": me.digestValue,
                "X-HTTP-Method": "POST"
              }
            })
            .then(function(response) {
              resolve(response);
            })
            .catch(function(error) {
              reject(error);
            });
        else {
          me.log(`Send email to: ${to}`);
          me.log(`From: ${from}`);
          me.log(`Subject: ${subject}`);
          me.log(`Body: ${body}`);
          resolve();
        }
      } else reject("From, To or Subject not provided.");
    });
  }

  log(message) {
    if (!this.inProduction && config.showConsoleActivityInDev)
      console.log(message);
  }

  getListItemType(listName) {
    let name = listName.replace(/\s/gi, "_x0020_");
    return `SP.Data.${name[0].toUpperCase() + name.substring(1)}ListItem`;
  }
}
